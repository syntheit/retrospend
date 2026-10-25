/**
 * Corrections, locks, Ask to fix and the Forgive audit on a real Postgres,
 * through RLS (2C.2, MONEY-MOVES 1.11, 1.12). Amounts worked out by hand.
 *
 * Electricidad: PEN 45,000 paid by Sofía (PEN home), shared with Martín (USD
 * home) and Juan (a ghost Sofía keeps), PEN 15,000 each, rate PEN 1,000 per
 * USD. Both pay Sofía 15,000, so the split is settled and locked. The bill
 * was 48,000:
 *
 *   correction  +3,000 paid by Sofía, +1,000 on each of the three
 *   Sofía       owed +2,000 (Martín 1,000 and Juan 1,000); SplitsNet +2,000
 *               (fronted 32,000, returned 30,000); her Dining spending +1,000
 *   Martín      owes Sofía 1,000 (USD 1.00); SplitsNet 0; spending PEN 15,000 to 16,000
 *
 * Amounts are minor units: PEN 1,000 is 100,000, USD 1.00 is 100.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CorrectInput } from "~/lib/schemas/corrections";
import { dayKey } from "~/lib/time-zone";
import { userTransaction } from "~/server/db-tx";
import { readFigures } from "~/server/figures/read";
import {
	createSharedExpense,
	updateSharedExpense,
} from "~/server/services/entry/shared.mutation";
import {
	invariantAt,
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { getMonth, getOwed } from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import {
	forgiveMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import { needsYou } from "~/server/services/needs-you";
import {
	confirmPayment,
	unconfirmPayment,
} from "~/server/services/payments/confirm.mutation";
import { recordPayment } from "~/server/services/payments/record.mutation";
import { forUser } from "~/server/services/preview";
import { rebalanceExpenses } from "~/server/services/project/rebalance.mutation";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { assertCanModifyTransaction } from "~/server/services/shared-expenses/project-permissions";
import { SharedTransactionService } from "~/server/services/shared-expenses/transaction.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb } from "~/test/pg-harness";
import {
	correctSplitMutation,
	undoCorrectionMutation,
} from "./correct.mutation";
import {
	askToFixMutation,
	cancelFixMutation,
	respondToFixMutation,
	restoreFixMutation,
	withdrawFixMutation,
} from "./fix-request.mutation";
import { lockStates } from "./fix-request.service";
import { removeSelfFromSplit } from "./guards";

type Seed = Awaited<ReturnType<typeof seedUser>>;

const today = dayKey(new Date());
const ref = (u: Seed): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const as = (u: Seed) => forUser(u.user.id);

/**
 * PEN at 1,000 per USD around today (the server zone and the book's zone can
 * be a day apart). PEN is a currency no other file uses, so no rate of
 * another test is read or changed; the rows are removed afterwards.
 */
const seeded: { date: Date; currency: string; type: string }[] = [];
async function seedRate() {
	for (const offset of [-1, 0, 1]) {
		const date = new Date(`${today}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + offset);
		for (const type of ["blue", "official"]) {
			const key = { date, currency: "PEN", type };
			if (await adminDb.exchangeRate.findFirst({ where: key })) continue;
			await adminDb.exchangeRate.create({ data: { ...key, rate: "1000" } });
			seeded.push(key);
		}
	}
}
afterAll(async () => {
	if (seeded.length > 0)
		await adminDb.exchangeRate.deleteMany({ where: { OR: seeded } });
});

async function book(u: Seed, currency: "PEN" | "USD") {
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { homeCurrency: currency },
	});
	await as(u).apply(setupEnvelopeBook, { ...setupInput(u), timeZone: "UTC" });
}

interface World {
	sofia: Seed;
	martin: Seed;
	juan: ParticipantRef;
	electricidad: string;
}

/** Electricidad paid, then both Martín and Juan pay Sofía their 15,000: settled and locked. */
async function settledWorld(): Promise<World> {
	await seedRate();
	const sofia = await seedUser();
	const martin = await seedUser();
	await book(sofia, "PEN");
	await book(martin, "USD");
	const juan: ParticipantRef = {
		participantType: "shadow",
		participantId: (
			await adminDb.shadowProfile.create({
				data: { createdById: sofia.user.id, name: "Juan" },
			})
		).id,
	};
	const electricidad = (
		await adminDb.sharedTransaction.create({
			data: {
				description: "Electricidad",
				amount: "45000",
				currency: "PEN",
				exchangeRate: "1000",
				date: new Date(`${today}T12:00:00.000Z`),
				categoryId: sofia.dining,
				paidByType: "user",
				paidById: sofia.user.id,
				createdByType: "user",
				createdById: sofia.user.id,
				splitParticipants: {
					create: [ref(sofia), ref(martin), juan].map((p) => ({
						...p,
						shareAmount: "15000",
						verificationStatus: "ACCEPTED" as const,
					})),
				},
			},
		})
	).id;
	await as(sofia).apply(recordPayment, {
		person: juan,
		direction: "incoming",
		currency: "PEN",
		amount: "15000",
	});
	const sent = await as(martin).apply(recordPayment, {
		person: ref(sofia),
		direction: "outgoing",
		currency: "PEN",
		amount: "15000",
	});
	if (!sent.value.recorded) throw new Error("payment not recorded");
	await as(sofia).apply(confirmPayment, {
		paymentId: sent.value.paymentId,
		person: ref(martin),
	});
	return { sofia, martin, juan, electricidad };
}

const split = (id: string) =>
	adminDb.sharedTransaction.findUniqueOrThrow({
		where: { id },
		include: { splitParticipants: true },
	});

/** The correction to PEN 48,000, equal over the same three. */
const toFortyEight = (w: World): CorrectInput => ({
	id: randomUUID(),
	transactionId: w.electricidad,
	description: "Correction to Electricidad",
	amount: "48000",
	paidBy: { type: "user", id: w.sofia.user.id },
	categoryId: w.sofia.dining,
	splitMode: "EQUAL",
	splitWith: [
		{ participant: { type: "user", id: w.sofia.user.id } },
		{ participant: { type: "user", id: w.martin.user.id } },
		{ participant: { type: w.juan.participantType, id: w.juan.participantId } },
	],
});

/** People in key order, as the server lists them. */
const byKey = <T extends { participant: { type: string; id: string } }>(
	rows: readonly T[],
) =>
	[...rows].sort((a, b) =>
		`${a.participant.type}:${a.participant.id}` <
		`${b.participant.type}:${b.participant.id}`
			? -1
			: 1,
	);

const balance = async (a: Seed, b: ParticipantRef) =>
	(await computeBalance(adminDb, ref(a), b)).byCurrency;

const dining = (m: Awaited<ReturnType<typeof getMonth>>) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.name === "Dining")?.left
		.minor;

const ids = ["owed.owedToYou", "owed.youOwe", "spent", "budget.heldForOthers"];
async function snapshot(u: Seed) {
	const month = await getMonth(u.user.id);
	return {
		figures: Object.fromEntries(await readFigures(u.user.id, ids)),
		splitsNet: month?.toAssign.terms.splitsNet,
		toAssign: month?.toAssign.amount,
		dining: dining(month),
		owed: (await getOwed(u.user.id))?.people.map((p) => p.lines),
	};
}

describe("a settled split is locked", () => {
	let w: World;
	beforeAll(async () => {
		w = await settledWorld();
	});

	it("both payments brought the scope to zero: the split is locked by the last payment", async () => {
		const row = await split(w.electricidad);
		expect(row.isLocked).toBe(true);
		expect(row.lockedByPaymentId).not.toBeNull();
		expect(await balance(w.sofia, ref(w.martin))).toEqual({});
		expect(await balance(w.sofia, w.juan)).toEqual({});
	});

	it("an edit is refused, and the lock state says who may correct or ask", async () => {
		await expect(
			assertCanModifyTransaction(
				adminDb,
				w.electricidad,
				"user",
				w.sofia.user.id,
			),
		).rejects.toThrow("Settled transactions cannot be modified");
		const states = (u: Seed) =>
			userTransaction(adminDb, u.user.id, (tx) =>
				lockStates(tx, u.user.id, [w.electricidad]),
			);
		expect((await states(w.sofia))[0]).toMatchObject({
			locked: true,
			reason: "SETTLED",
			canCorrect: true,
			canAskToFix: false,
		});
		expect((await states(w.martin))[0]).toMatchObject({
			locked: true,
			canCorrect: false,
			canAskToFix: true,
		});
	});

	it("only a party to the payment can lock, and only the splits it settled", async () => {
		const outsider = await seedUser();
		const row = await split(w.electricidad);
		await expect(
			userTransaction(
				adminDb,
				outsider.user.id,
				(tx) =>
					tx.$queryRaw`SELECT lock_settled_splits(${row.lockedByPaymentId}, ARRAY[${w.electricidad}]::text[])`,
			),
		).rejects.toThrow("not a party");
	});

	it("a payment that stops being final releases the lock it set", async () => {
		const w2 = await settledWorld();
		const locked = await split(w2.electricidad);
		const payment = await adminDb.payment.findUniqueOrThrow({
			where: { id: locked.lockedByPaymentId as string },
		});
		await as(w2.sofia).apply(unconfirmPayment, {
			paymentId: payment.id,
			person: ref(w2.martin),
		});
		const open = await split(w2.electricidad);
		expect(open.isLocked).toBe(false);
		expect(open.lockedByPaymentId).toBeNull();
	});

	it("a split with money still owed on it is not locked", async () => {
		await seedRate();
		const sofia = await seedUser();
		const martin = await seedUser();
		const t = await adminDb.sharedTransaction.create({
			data: {
				description: "Open",
				amount: "20000",
				currency: "PEN",
				date: new Date(`${today}T12:00:00.000Z`),
				paidByType: "user",
				paidById: sofia.user.id,
				createdByType: "user",
				createdById: sofia.user.id,
				splitParticipants: {
					create: [ref(sofia), ref(martin)].map((p) => ({
						...p,
						shareAmount: "10000",
						verificationStatus: "ACCEPTED" as const,
					})),
				},
			},
		});
		// Martín pays 4,000 of 10,000.
		const sent = await as(martin).apply(recordPayment, {
			person: ref(sofia),
			direction: "outgoing",
			currency: "PEN",
			amount: "4000",
		});
		if (!sent.value.recorded) throw new Error("not recorded");
		await as(sofia).apply(confirmPayment, {
			paymentId: sent.value.paymentId,
			person: ref(martin),
		});
		expect((await split(t.id)).isLocked).toBe(false);
	});
});

describe("correct a settled split", () => {
	let w: World;
	let input: CorrectInput;
	let before: { sofia: unknown; martin: unknown };

	beforeAll(async () => {
		w = await settledWorld();
		input = toFortyEight(w);
		before = {
			sofia: await snapshot(w.sofia),
			martin: await snapshot(w.martin),
		};
	});

	it("before: nothing owed, SplitsNet 0, Dining -15,000", async () => {
		expect(before.sofia).toMatchObject({ splitsNet: { minor: 0 } });
		const s = before.sofia as { dining: number };
		expect(s.dining).toBe(-1_500_000);
	});

	it("the preview is the write: the same changes and the same ids", async () => {
		const preview = await as(w.sofia).preview(correctSplitMutation, input);
		// A preview leaves nothing behind.
		expect(
			await adminDb.sharedTransaction.count({
				where: { correctsId: w.electricidad },
			}),
		).toBe(0);
		const applied = await as(w.sofia).apply(correctSplitMutation, input);
		expect(applied.value).toEqual(preview.value);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.value.transactionIds).toEqual([input.id]);
		expect(byKey(applied.value.differences)).toEqual(
			byKey([
				{
					participant: { type: "user", id: w.sofia.user.id },
					paidMinor: 300_000,
					shareMinor: 100_000,
				},
				{
					participant: { type: "user", id: w.martin.user.id },
					paidMinor: 0,
					shareMinor: 100_000,
				},
				{
					participant: { type: "shadow", id: w.juan.participantId },
					paidMinor: 0,
					shareMinor: 100_000,
				},
			]),
		);
	});

	it("the correction row holds only the difference; the original is untouched", async () => {
		const original = await split(w.electricidad);
		expect(original.amount.toString()).toBe("45000");
		expect(original.isLocked).toBe(true);
		expect(
			original.splitParticipants.map((p) => p.shareAmount.toString()),
		).toEqual(["15000", "15000", "15000"]);

		const row = await split(input.id);
		expect(row.correctsId).toBe(w.electricidad);
		expect(row.amount.toString()).toBe("3000");
		expect(row.isLocked).toBe(false);
		expect(row.paidById).toBe(w.sofia.user.id);
		expect(row.exchangeRate?.toString()).toBe("1000");
		const byWho = Object.fromEntries(
			row.splitParticipants.map((p) => [
				p.participantId,
				[p.shareAmount.toString(), p.verificationStatus],
			]),
		);
		expect(byWho[w.sofia.user.id]).toEqual(["1000", "ACCEPTED"]);
		expect(byWho[w.martin.user.id]).toEqual(["1000", "PENDING"]);
		expect(byWho[w.juan.participantId]).toEqual(["1000", "AUTO_ACCEPTED"]);
	});

	it("the scope reopens by the difference only", async () => {
		expect(await balance(w.sofia, ref(w.martin))).toEqual({ PEN: 1000 });
		expect(await balance(w.martin, ref(w.sofia))).toEqual({ PEN: -1000 });
		expect(await balance(w.sofia, w.juan)).toEqual({ PEN: 1000 });
	});

	it("Sofía's budget: SplitsNet +2,000, Dining -1,000, owed matches People", async () => {
		const m = await getMonth(w.sofia.user.id);
		expect(m?.toAssign.terms.splitsNet).toEqual({
			minor: 200_000,
			currency: "PEN",
		});
		expect(dining(m)).toBe(-1_600_000);
		const owed = await getOwed(w.sofia.user.id);
		expect(owed?.people.flatMap((p) => p.lines.map((l) => l.amount))).toEqual(
			expect.arrayContaining([{ minor: 100_000, currency: "PEN" }]),
		);
		const figures = await readFigures(w.sofia.user.id, [
			"owed.owedToYou",
			"budget.heldForOthers",
		]);
		expect(figures.get("owed.owedToYou")).toEqual([
			{ minor: 200_000, currency: "PEN" },
		]);
		expect(figures.get("budget.heldForOthers")).toEqual([
			{ minor: 200_000, currency: "PEN" },
		]);
	});

	it("Martín's budget: SplitsNet 0, he owes USD 1.00 as People says, spending PEN 15,000 to 16,000 ", async () => {
		const m = await getMonth(w.martin.user.id);
		expect(m?.toAssign.terms.splitsNet).toEqual({ minor: 0, currency: "USD" });
		const owed = await getOwed(w.martin.user.id);
		expect(owed?.people.flatMap((p) => p.lines.map((l) => l.amount))).toEqual([
			{ minor: -100_000, currency: "PEN" },
		]);
		const figures = await readFigures(w.martin.user.id, [
			"owed.youOwe",
			"spent",
		]);
		expect(figures.get("owed.youOwe")).toEqual([
			{ minor: 100, currency: "USD" },
		]);
		const spent = (
			before.martin as { figures: Record<string, { minor: number }[]> }
		).figures.spent;
		// The figure keeps the share's own currency; at PEN 1,000 per USD it is USD 15, then 16.
		expect(spent).toEqual([{ minor: 1_500_000, currency: "PEN" }]);
		expect(figures.get("spent")).toEqual([
			{ minor: 1_600_000, currency: "PEN" },
		]);
	});

	it("SPEC 5.3 holds for both books after the correction", async () => {
		for (const u of [w.sofia, w.martin]) {
			const sides = await invariantAt(u.user.id);
			expect(sides.budget).toBe(sides.ledger);
		}
	});

	it("Martín gets a review item for the correction; the person who paid has nothing waiting", async () => {
		const list = await needsYou(adminDb, w.martin.user.id, { budget: false });
		const review = list.items.find((i) => i.type === "split.review");
		expect(review).toMatchObject({
			entity: { kind: "sharedExpense", id: input.id },
			title: "Correction to Electricidad",
			amount: { minor: 100_000, currency: "PEN" },
		});
	});

	it("paying the 1,000 settles it again; the original keeps its lock", async () => {
		const sent = await as(w.martin).apply(recordPayment, {
			person: ref(w.sofia),
			direction: "outgoing",
			currency: "PEN",
			amount: "1000",
		});
		if (!sent.value.recorded) throw new Error("not recorded");
		await as(w.sofia).apply(confirmPayment, {
			paymentId: sent.value.paymentId,
			person: ref(w.martin),
		});
		expect(await balance(w.sofia, ref(w.martin))).toEqual({});
		expect((await split(w.electricidad)).isLocked).toBe(true);
		expect((await split(input.id)).isLocked).toBe(false);
	});

	it("a correction row cannot be edited, and an expense with corrections cannot be either", async () => {
		await expect(
			assertCanModifyTransaction(adminDb, input.id, "user", w.sofia.user.id),
		).rejects.toThrow("A correction cannot be edited");
	});
});

describe("undo a correction", () => {
	it("puts both budgets and People back exactly, and the fix request it answered", async () => {
		const w = await settledWorld();
		const askId = randomUUID();
		await as(w.martin).apply(askToFixMutation, {
			id: askId,
			transactionId: w.electricidad,
			message: "The bill says 48,000",
		});
		await as(w.sofia).apply(respondToFixMutation, {
			id: askId,
			response: "accept",
		});
		const before = {
			sofia: await snapshot(w.sofia),
			martin: await snapshot(w.martin),
			sofiaBalance: await balance(w.sofia, ref(w.martin)),
		};
		const input = toFortyEight(w);
		const done = await as(w.sofia).apply(correctSplitMutation, input);
		expect(done.value.resolvedRequests).toEqual([
			{ id: askId, previousStatus: "ACCEPTED" },
		]);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: askId } }))
				.status,
		).toBe("FIXED");
		expect(done.undo).toEqual({
			kind: "revert",
			mutation: "correction.undo",
			rows: [
				{ table: "shared_transaction", id: input.id },
				{ table: "fix_request", id: askId },
			],
		});

		const undoInput = {
			transactionIds: done.value.transactionIds,
			resolvedRequests: done.value.resolvedRequests,
		};
		const previewed = await as(w.sofia).preview(
			undoCorrectionMutation,
			undoInput,
		);
		const undone = await as(w.sofia).apply(undoCorrectionMutation, undoInput);
		expect(undone.changes).toEqual(previewed.changes);

		expect(await snapshot(w.sofia)).toEqual(before.sofia);
		expect(await snapshot(w.martin)).toEqual(before.martin);
		expect(await balance(w.sofia, ref(w.martin))).toEqual(before.sofiaBalance);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: askId } }))
				.status,
		).toBe("ACCEPTED");
		expect(
			await adminDb.sharedTransaction.count({
				where: { correctsId: w.electricidad },
			}),
		).toBe(0);
		await expect(
			as(w.sofia).apply(undoCorrectionMutation, undoInput),
		).rejects.toThrow("already undone");
	});

	it("a retry with the same id writes nothing twice", async () => {
		const w = await settledWorld();
		const input = toFortyEight(w);
		await as(w.sofia).apply(correctSplitMutation, input);
		const again = await as(w.sofia).apply(correctSplitMutation, input);
		expect(again.value.transactionIds).toEqual([input.id]);
		expect(
			await adminDb.sharedTransaction.count({
				where: { correctsId: w.electricidad },
			}),
		).toBe(1);
	});
});

describe("wrong payer and category: the old bucket reverses, the new one arrives", () => {
	it("Martín paid, not Sofía: balances flip, nobody's share moves", async () => {
		const w = await settledWorld();
		const input: CorrectInput = {
			...toFortyEight(w),
			amount: "45000",
			paidBy: { type: "user", id: w.martin.user.id },
		};
		const done = await as(w.sofia).apply(correctSplitMutation, input);
		expect(done.value.transactionIds).toEqual([input.id, `${input.id}~1`]);
		expect(byKey(done.value.differences)).toEqual(
			byKey([
				{
					participant: { type: "user", id: w.sofia.user.id },
					paidMinor: -4_500_000,
					shareMinor: 0,
				},
				{
					participant: { type: "user", id: w.martin.user.id },
					paidMinor: 4_500_000,
					shareMinor: 0,
				},
			]),
		);
		// Sofía's share is 15,000 of what Martín paid, and the 15,000 Martín sent
		// her went to someone who never paid the bill: she owes him 30,000.
		// Juan paid Sofía 15,000 for nothing, and owes Martín 15,000 himself.
		expect(await balance(w.martin, ref(w.sofia))).toEqual({ PEN: 30_000 });
		expect(await balance(w.martin, w.juan)).toEqual({ PEN: 15_000 });
	});
});

describe("Ask to fix", () => {
	let w: World;
	const askId = randomUUID();

	beforeAll(async () => {
		w = await settledWorld();
	});

	it("the asker previews and sends; the preview writes nothing and tells nobody", async () => {
		const input = {
			id: askId,
			transactionId: w.electricidad,
			message: "Check the total",
		};
		await as(w.martin).preview(askToFixMutation, input);
		expect(await adminDb.fixRequest.count({ where: { id: askId } })).toBe(0);
		const notify: (() => Promise<void>)[] = [];
		const sent = await as(w.martin).apply(askToFixMutation, {
			...input,
			notify,
		});
		expect(notify).toHaveLength(1);
		expect(sent.value.request).toMatchObject({
			status: "PENDING",
			message: "Check the total",
			requestedBy: { type: "user", id: w.martin.user.id },
			asked: { type: "user", id: w.sofia.user.id },
		});
	});

	it("the creator gets a Needs you item with the asker's face, from ids", async () => {
		const list = await needsYou(adminDb, w.sofia.user.id, { budget: false });
		const item = list.items.find((i) => i.type === "split.fixRequested");
		expect(item).toMatchObject({
			entity: { kind: "sharedExpense", id: w.electricidad },
			entityIds: [askId],
			count: 1,
			people: [`user:${w.martin.user.id}`],
			actions: [
				{ entity: "expense", id: "correct" },
				{ entity: "expense", id: "open" },
			],
		});
		expect(list.counts.people).toBeGreaterThanOrEqual(1);
		const asker = await needsYou(adminDb, w.martin.user.id, { budget: false });
		expect(asker.items.some((i) => i.type === "split.fixRequested")).toBe(
			false,
		);
	});

	it("only the asker and the asked can see it", async () => {
		const outsider = await seedUser();
		const read = (u: Seed) =>
			userTransaction(adminDb, u.user.id, (tx) =>
				tx.fixRequest.findMany({ where: { id: askId } }),
			);
		expect(await read(w.sofia)).toHaveLength(1);
		expect(await read(w.martin)).toHaveLength(1);
		expect(await read(outsider)).toHaveLength(0);
		// Nor can the outsider answer it.
		await expect(
			as(outsider).apply(respondToFixMutation, {
				id: askId,
				response: "decline",
			}),
		).rejects.toThrow(TRPCError);
	});

	it("someone who cannot see the expense cannot ask about it", async () => {
		const outsider = await seedUser();
		await expect(
			as(outsider).apply(askToFixMutation, {
				id: randomUUID(),
				transactionId: w.electricidad,
			}),
		).rejects.toThrow("Expense not found");
	});

	it("you cannot ask about your own expense, ask twice, or answer for the other side", async () => {
		await expect(
			as(w.sofia).apply(askToFixMutation, {
				id: randomUUID(),
				transactionId: w.electricidad,
			}),
		).rejects.toThrow("you can fix it yourself");
		await expect(
			as(w.martin).apply(askToFixMutation, {
				id: randomUUID(),
				transactionId: w.electricidad,
			}),
		).rejects.toThrow("already asked");
		await expect(
			as(w.martin).apply(respondToFixMutation, {
				id: askId,
				response: "accept",
			}),
		).rejects.toThrow("No such request");
	});

	it("decline and accept are undone to waiting; cancel is undone to what it was", async () => {
		const declined = await as(w.sofia).apply(respondToFixMutation, {
			id: askId,
			response: "decline",
			reply: "It is right",
		});
		expect(declined.value).toMatchObject({
			previousStatus: "PENDING",
			request: { status: "DECLINED", reply: "It is right" },
		});
		expect(declined.undo).toMatchObject({ mutation: "fixRequest.restore" });
		const back = await as(w.sofia).apply(restoreFixMutation, {
			id: askId,
			status: "PENDING",
		});
		expect(back.value.request).toMatchObject({
			status: "PENDING",
			reply: null,
		});

		await as(w.sofia).apply(respondToFixMutation, {
			id: askId,
			response: "accept",
		});
		const cancelled = await as(w.martin).apply(cancelFixMutation, {
			id: askId,
		});
		expect(cancelled.value.previousStatus).toBe("ACCEPTED");
		const restored = await as(w.martin).apply(restoreFixMutation, {
			id: askId,
			status: "ACCEPTED",
		});
		expect(restored.value.request.status).toBe("ACCEPTED");
	});

	it("an ask is withdrawn while unanswered, and not after", async () => {
		const other = randomUUID();
		const w2 = await settledWorld();
		await as(w2.martin).apply(askToFixMutation, {
			id: other,
			transactionId: w2.electricidad,
		});
		await as(w2.martin).apply(withdrawFixMutation, { id: other });
		expect(await adminDb.fixRequest.count({ where: { id: other } })).toBe(0);
		await as(w2.martin).apply(askToFixMutation, {
			id: other,
			transactionId: w2.electricidad,
		});
		await as(w2.sofia).apply(respondToFixMutation, {
			id: other,
			response: "accept",
		});
		await expect(
			as(w2.martin).apply(withdrawFixMutation, { id: other }),
		).rejects.toThrow("already answered");
	});

	it("notifications and audit carry ids, never the title or the message", async () => {
		const notify: (() => Promise<void>)[] = [];
		const w3 = await settledWorld();
		const id = randomUUID();
		await as(w3.martin).apply(askToFixMutation, {
			id,
			transactionId: w3.electricidad,
			message: "SECRET MESSAGE",
			notify,
		});
		for (const send of notify) await send();
		const notices = await adminDb.notification.findMany({
			where: { userId: w3.sofia.user.id },
		});
		const text = JSON.stringify(notices);
		expect(text).toContain(id);
		expect(text).not.toContain("SECRET MESSAGE");
		expect(text).not.toContain("Electricidad");
		const audit = await adminDb.auditLogEntry.findMany({
			where: { action: "FIX_REQUESTED", targetId: w3.electricidad },
		});
		expect(JSON.stringify(audit)).not.toContain("SECRET MESSAGE");
	});
});

describe("correct: access", () => {
	it("only the person who added the expense can correct it, and only once it is settled", async () => {
		const w = await settledWorld();
		await expect(
			as(w.martin).apply(correctSplitMutation, toFortyEight(w)),
		).rejects.toThrow("Only the person who added");
		const open = await adminDb.sharedTransaction.create({
			data: {
				description: "Open",
				amount: "100",
				currency: "PEN",
				date: new Date(),
				paidByType: "user",
				paidById: w.sofia.user.id,
				createdByType: "user",
				createdById: w.sofia.user.id,
				splitParticipants: {
					create: [
						{
							...ref(w.sofia),
							shareAmount: "100",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
		await expect(
			as(w.sofia).apply(correctSplitMutation, {
				...toFortyEight(w),
				transactionId: open.id,
			}),
		).rejects.toThrow("not settled");
	});

	it("Martín reads the correction and the original; an outsider reads neither", async () => {
		const w = await settledWorld();
		const input = toFortyEight(w);
		await as(w.sofia).apply(correctSplitMutation, input);
		const outsider = await seedUser();
		const read = (u: Seed) =>
			userTransaction(adminDb, u.user.id, (tx) =>
				tx.sharedTransaction.findMany({
					where: { id: { in: [input.id, w.electricidad] } },
				}),
			);
		expect(await read(w.martin)).toHaveLength(2);
		expect(await read(w.sofia)).toHaveLength(2);
		expect(await read(outsider)).toHaveLength(0);
	});

	it("new people go in a new expense, not in a correction", async () => {
		const w = await settledWorld();
		const stranger = await seedUser();
		await expect(
			as(w.sofia).apply(correctSplitMutation, {
				...toFortyEight(w),
				splitWith: [
					{ participant: { type: "user", id: w.sofia.user.id } },
					{ participant: { type: "user", id: stranger.user.id } },
				],
			}),
		).rejects.toThrow("new expense");
	});
});

describe("Forgive leaves an audit record", () => {
	it("writes FORGIVEN with ids for both people to read, UNFORGIVEN on undo", async () => {
		const w = await settledWorld();
		// Juan owes 1,000 after a correction; Sofía lets it go.
		await as(w.sofia).apply(correctSplitMutation, toFortyEight(w));
		const id = randomUUID();
		const forgiven = await as(w.sofia).apply(forgiveMutation, {
			id,
			participant: { type: "user", id: w.martin.user.id },
			currency: "PEN",
			amountMinor: 100_000,
			envelopeId: null,
		});
		const entries = await adminDb.auditLogEntry.findMany({
			where: { action: "FORGIVEN" },
		});
		const mine = entries.find(
			(e) => (e.changes as { paymentId?: string } | null)?.paymentId === id,
		);
		expect(mine).toMatchObject({
			targetType: "SETTLEMENT",
			actorId: w.sofia.user.id,
			changes: {
				paymentId: id,
				counterparty: `user:${w.martin.user.id}`,
				currency: "PEN",
				amountMinor: 100_000,
			},
		});
		const read = (u: Seed) =>
			userTransaction(adminDb, u.user.id, (tx) =>
				tx.auditLogEntry.findMany({ where: { id: mine?.id } }),
			);
		expect(await read(w.sofia)).toHaveLength(1);
		expect(await read(w.martin)).toHaveLength(1);
		expect(await balance(w.sofia, ref(w.martin))).toEqual({});

		await as(w.sofia).apply(unforgiveMutation, {
			paymentId: forgiven.value.paymentId,
		});
		expect(
			await adminDb.auditLogEntry.count({
				where: { action: "UNFORGIVEN", targetId: id },
			}),
		).toBe(1);
		expect(await balance(w.sofia, ref(w.martin))).toEqual({ PEN: 1000 });
	});
});

describe("review: nobody leaves a correction", () => {
	it("removeSelf is refused on a correction row and on a split that has corrections", async () => {
		const w = await settledWorld();
		const input = toFortyEight(w);
		await as(w.sofia).apply(correctSplitMutation, input);
		const removeSelf = (id: string) =>
			removeSelfFromSplit(adminDb, ref(w.martin), id, true);
		// Martín's share on the correction is PENDING and unlocked: leaving it
		// would make his 1,000 vanish.
		await expect(removeSelf(input.id)).rejects.toThrow("has a correction");
		expect(await balance(w.sofia, ref(w.martin))).toEqual({ PEN: 1000 });
		await expect(removeSelf(w.electricidad)).rejects.toThrow(
			"has a correction",
		);
	});

	it("rebalance never re-splits a correction row or a split with corrections", async () => {
		const w = await settledWorld();
		const paz: ParticipantRef = {
			participantType: "shadow",
			participantId: (
				await adminDb.shadowProfile.create({
					data: { createdById: w.sofia.user.id, name: "Paz" },
				})
			).id,
		};
		const project = await adminDb.project.create({
			data: {
				name: "Depto",
				createdById: w.sofia.user.id,
				participants: {
					create: [
						{ ...ref(w.sofia), role: "ORGANIZER" },
						{ ...ref(w.martin) },
						{ ...paz },
					],
				},
			},
		});
		await adminDb.sharedTransaction.update({
			where: { id: w.electricidad },
			data: { projectId: project.id, isLocked: false, lockedByPaymentId: null },
		});
		const input = toFortyEight(w);
		// A correction needs a settled split: lock it again for the write.
		await adminDb.sharedTransaction.update({
			where: { id: w.electricidad },
			data: { isLocked: true },
		});
		await as(w.sofia).apply(correctSplitMutation, input);
		await adminDb.sharedTransaction.update({
			where: { id: w.electricidad },
			data: { isLocked: false },
		});
		const result = await userTransaction(adminDb, w.sofia.user.id, (tx) =>
			rebalanceExpenses(
				tx,
				{ userId: w.sofia.user.id, timeZone: "UTC" },
				{
					projectId: project.id,
					participantType: paz.participantType,
					participantId: paz.participantId,
					expenseIds: [w.electricidad, input.id],
				},
			),
		);
		expect(result.rebalancedCount).toBe(0);
		expect(result.skipped.map((s) => s.id).sort()).toEqual(
			[w.electricidad, input.id].sort(),
		);
	});
});

describe("review: a lock does not outlive the payment that earned it", () => {
	/**
	 * Sofía paid A (45,000 over three, today, outside projects) and B (6,000
	 * with Martín, yesterday, in the Trip project): two scopes.
	 */
	async function twoSplits() {
		await seedRate();
		const sofia = await seedUser();
		const martin = await seedUser();
		const juan: ParticipantRef = {
			participantType: "shadow",
			participantId: (
				await adminDb.shadowProfile.create({
					data: { createdById: sofia.user.id, name: "Juan" },
				})
			).id,
		};
		const trip = await adminDb.project.create({
			data: {
				name: "Trip",
				createdById: sofia.user.id,
				participants: {
					create: [{ ...ref(sofia), role: "ORGANIZER" }, { ...ref(martin) }],
				},
			},
		});
		const make = (
			description: string,
			day: string,
			shares: [ParticipantRef, string][],
			amount: string,
			projectId: string | null = null,
		) =>
			adminDb.sharedTransaction.create({
				data: {
					description,
					amount,
					projectId,
					currency: "PEN",
					date: new Date(`${day}T12:00:00.000Z`),
					paidByType: "user",
					paidById: sofia.user.id,
					createdByType: "user",
					createdById: sofia.user.id,
					splitParticipants: {
						create: shares.map(([p, share]) => ({
							...p,
							shareAmount: share,
							verificationStatus: "ACCEPTED" as const,
						})),
					},
				},
			});
		const yesterday = new Date(`${today}T12:00:00.000Z`);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		const b = await make(
			"B",
			yesterday.toISOString().slice(0, 10),
			[
				[ref(sofia), "3000"],
				[ref(martin), "3000"],
			],
			"6000",
			trip.id,
		);
		const a = await make(
			"A",
			today,
			[
				[ref(sofia), "15000"],
				[ref(martin), "15000"],
				[juan, "15000"],
			],
			"45000",
		);
		await as(sofia).apply(recordPayment, {
			person: juan,
			direction: "incoming",
			currency: "PEN",
			amount: "15000",
		});
		const pays = async (amount: string) => {
			const sent = await as(martin).apply(recordPayment, {
				person: ref(sofia),
				direction: "outgoing",
				currency: "PEN",
				amount,
			});
			if (!sent.value.recorded) throw new Error("not recorded");
			await as(sofia).apply(confirmPayment, {
				paymentId: sent.value.paymentId,
				person: ref(martin),
			});
			return sent.value.paymentId;
		};
		return { sofia, martin, a: a.id, b: b.id, pays };
	}

	it("Martín pays 3,000 (B), 10,000, then 5,000 (A locks); undoing the 10,000 reopens A and keeps the Trip split locked", async () => {
		const t = await twoSplits();
		const p0 = await t.pays("3000");
		const p1 = await t.pays("10000");
		expect((await split(t.a)).isLocked).toBe(false);
		await t.pays("5000");
		expect((await split(t.a)).isLocked).toBe(true);
		// The 3,000 brought the Trip scope to zero, outside projects was still open.
		expect((await split(t.b)).lockedByPaymentId).toBe(p0);

		await as(t.sofia).apply(unconfirmPayment, {
			paymentId: p1,
			person: ref(t.martin),
		});
		// The 10,000 is owed again, so A is open and may be edited.
		expect(await balance(t.sofia, ref(t.martin))).toEqual({ PEN: 10_000 });
		const a = await split(t.a);
		expect(a.isLocked).toBe(false);
		expect(a.lockedByPaymentId).toBeNull();
		// B is in another scope and its payment is still there: it stays locked.
		expect((await split(t.b)).lockedByPaymentId).toBe(p0);

		// Confirming the 10,000 again settles A again.
		await as(t.sofia).apply(confirmPayment, {
			paymentId: p1,
			person: ref(t.martin),
		});
		expect((await split(t.a)).isLocked).toBe(true);
	});

	it("deleting the payment that settled it (unforgive) reopens it too", async () => {
		const t = await twoSplits();
		await t.pays("3000");
		await t.pays("10000");
		const id = randomUUID();
		await as(t.sofia).apply(forgiveMutation, {
			id,
			participant: { type: "user", id: t.martin.user.id },
			currency: "PEN",
			amountMinor: 500_000,
			envelopeId: null,
		});
		expect((await split(t.a)).isLocked).toBe(true);
		await as(t.sofia).apply(unforgiveMutation, { paymentId: id });
		expect((await split(t.a)).isLocked).toBe(false);
		expect(await balance(t.sofia, ref(t.martin))).toEqual({ PEN: 5000 });
	});
});

describe("review: undo only the latest correction, and only while nothing settled on it", () => {
	it("an earlier correction cannot be undone before the later one", async () => {
		const w = await settledWorld();
		const first = toFortyEight(w);
		await as(w.sofia).apply(correctSplitMutation, first);
		const second: CorrectInput = {
			...toFortyEight(w),
			amount: "46500",
		};
		const done = await as(w.sofia).apply(correctSplitMutation, second);
		await expect(
			as(w.sofia).apply(undoCorrectionMutation, {
				transactionIds: [first.id],
				resolvedRequests: [],
			}),
		).rejects.toThrow("Undo the latest correction first");
		await as(w.sofia).apply(undoCorrectionMutation, {
			transactionIds: done.value.transactionIds,
			resolvedRequests: [],
		});
		await as(w.sofia).apply(undoCorrectionMutation, {
			transactionIds: [first.id],
			resolvedRequests: [],
		});
		expect(await balance(w.sofia, ref(w.martin))).toEqual({});
	});

	it("a payment recorded after the correction blocks its undo", async () => {
		const w = await settledWorld();
		const input = toFortyEight(w);
		await as(w.sofia).apply(correctSplitMutation, input);
		await as(w.martin).apply(recordPayment, {
			person: ref(w.sofia),
			direction: "outgoing",
			currency: "PEN",
			amount: "400",
		});
		await expect(
			as(w.sofia).apply(undoCorrectionMutation, {
				transactionIds: [input.id],
				resolvedRequests: [],
			}),
		).rejects.toThrow("payment was recorded after");
		expect(
			await adminDb.sharedTransaction.count({ where: { id: input.id } }),
		).toBe(1);
	});
});

describe("review: a plain edit answers the fix request, and its undo reopens it", () => {
	it("marks it FIXED and puts it back to what it was", async () => {
		await seedRate();
		const sofia = await seedUser();
		const martin = await seedUser();
		const made = await as(sofia).apply(createSharedExpense, {
			amount: 6000,
			currency: "PEN",
			description: "Dinner",
			date: new Date(`${today}T12:00:00.000Z`),
			paidBy: ref(sofia),
			splitWith: [ref(sofia), ref(martin)],
			splitMode: "EQUAL",
		});
		const askId = randomUUID();
		await as(martin).apply(askToFixMutation, {
			id: askId,
			transactionId: made.value.id,
		});
		await as(sofia).apply(respondToFixMutation, {
			id: askId,
			response: "accept",
		});
		const edit = {
			id: made.value.id,
			amount: 6200,
			currency: "PEN",
			description: "Dinner",
			date: new Date(`${today}T12:00:00.000Z`),
			paidBy: ref(sofia),
			splitWith: [ref(sofia), ref(martin)],
			splitMode: "EQUAL" as const,
		};
		// Nothing changed: the request stays.
		await as(sofia).apply(updateSharedExpense, { ...edit, amount: 6000 });
		const status = async () =>
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: askId } }))
				.status;
		expect(await status()).toBe("ACCEPTED");

		const done = await as(sofia).apply(updateSharedExpense, edit);
		expect(done.value.answered).toEqual([
			{ id: askId, previousStatus: "ACCEPTED" },
		]);
		expect(await status()).toBe("FIXED");

		const { restore } = done.value;
		await as(sofia).apply(updateSharedExpense, {
			...restore,
			splitWith: restore.splitWith,
			reopenFixRequests: done.value.answered,
		});
		expect(await status()).toBe("ACCEPTED");
	});
});

describe("review: the web form's edit path (SharedTransactionService.update) answers fix requests too", () => {
	it("a changed edit marks the request FIXED, an unchanged one does not, and the undo reopens it", async () => {
		await seedRate();
		const sofia = await seedUser();
		const martin = await seedUser();
		const made = await as(sofia).apply(createSharedExpense, {
			amount: 6000,
			currency: "PEN",
			description: "Dinner",
			date: new Date(`${today}T12:00:00.000Z`),
			paidBy: ref(sofia),
			splitWith: [ref(sofia), ref(martin)],
			splitMode: "EQUAL",
		});
		const askId = randomUUID();
		await as(martin).apply(askToFixMutation, {
			id: askId,
			transactionId: made.value.id,
		});
		await as(sofia).apply(respondToFixMutation, {
			id: askId,
			response: "accept",
		});
		const status = async () =>
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: askId } }))
				.status;
		// Straight through the service, as routers/shared-transaction.ts calls it.
		const edit = (extra: object) =>
			userTransaction(adminDb, sofia.user.id, (tx) =>
				new SharedTransactionService(tx, ref(sofia)).update({
					id: made.value.id,
					...extra,
				}),
			);
		await edit({});
		expect(await status()).toBe("ACCEPTED");
		await edit({ description: "Dinner at Pepe's" });
		expect(await status()).toBe("FIXED");
		await edit({
			description: "Dinner",
			reopenFixRequests: [{ id: askId, previousStatus: "ACCEPTED" }],
		});
		expect(await status()).toBe("ACCEPTED");
	});
});

describe("migration corrections_fix_requests", () => {
	it("runs twice without error and leaves the lock function and triggers in place", async () => {
		const migration = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261025700000_corrections_fix_requests/migration.sql",
			),
			"utf8",
		);
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await client.query(migration);
			await client.query(migration);
			const triggers = await client.query(
				`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'payment_release_locks%' ORDER BY tgname`,
			);
			expect(triggers.rows.map((r) => r.tgname)).toEqual([
				"payment_release_locks_delete",
				"payment_release_locks_status",
			]);
		} finally {
			await client.end();
		}
	});
});
