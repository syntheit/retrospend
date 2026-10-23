/**
 * Splits in the envelope budget on a real Postgres (P3), through RLS:
 * fronting and repayment (S5), the participant's own share category (D19)
 * with its smart default stored on read, project routing (D31), forgive
 * (C14) with preview, undo and retries, the budget's owed matching People
 * for FINALIZED-only settlements, Use my plan's rest, the held figure and
 * the splits_budget migration applied twice. USD book, so values need no
 * rate. Amounts are minor units.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { readFigures } from "~/server/figures/read";
import { deleteSharedExpense } from "~/server/services/entry/shared.mutation";
import { applyPlanFor, undoPlan } from "~/server/services/income/plan-seam";
import { forUser } from "~/server/services/preview";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { getMonth, getOwed } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";
import {
	forgiveMutation,
	setProjectRoutingMutation,
	setShareCategoryMutation,
	unforgiveMutation,
} from "./splits.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });
type Party = { type: "user" | "shadow"; id: string };

async function split(p: {
	paidBy: Party;
	createdBy: Party;
	amount: number;
	shares: Array<[Party, number]>;
	categoryId?: string | null;
	projectId?: string | null;
	status?: "ACCEPTED" | "PENDING" | "REJECTED";
}) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Split",
			amount: new Prisma.Decimal(p.amount),
			currency: "USD",
			date: new Date(),
			categoryId: p.categoryId ?? null,
			projectId: p.projectId ?? null,
			paidByType: p.paidBy.type,
			paidById: p.paidBy.id,
			createdByType: p.createdBy.type,
			createdById: p.createdBy.id,
			splitParticipants: {
				create: p.shares.map(([who, share]) => ({
					participantType: who.type,
					participantId: who.id,
					shareAmount: new Prisma.Decimal(share),
					verificationStatus: p.status ?? "ACCEPTED",
				})),
			},
		},
	});
}

async function pay(from: Party, to: Party, amount: number) {
	const id = randomUUID();
	await adminDb.payment.create({
		data: {
			id,
			payerType: from.type,
			payerId: from.id,
			payeeType: to.type,
			payeeId: to.id,
			amount: new Prisma.Decimal(amount),
			currency: "USD",
			paidOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
			recordedByType: "user",
			recordedById: to.id,
			status: "FINALIZED",
		},
	});
	await adminDb.settlement.create({
		data: {
			fromParticipantType: from.type,
			fromParticipantId: from.id,
			toParticipantType: to.type,
			toParticipantId: to.id,
			amount: new Prisma.Decimal(amount),
			currency: "USD",
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
			settledAt: new Date(),
			paymentGroupId: id,
		},
	});
}

const rowLeft = (m: Awaited<ReturnType<typeof getMonth>>, name: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.name === name)?.left
		.minor;

describe("splits in the envelope budget on Postgres", () => {
	let me: Awaited<ReturnType<typeof seedUser>>;
	let sam: Awaited<ReturnType<typeof createTestUser>>["user"];
	let paz: Party;
	let meP: Party;
	let samP: Party;
	let project: string;
	let envelopes: Record<string, string>;

	beforeAll(async () => {
		me = await seedUser();
		sam = (await createTestUser()).user;
		meP = { type: "user", id: me.user.id };
		samP = { type: "user", id: sam.id };
		paz = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: me.user.id, name: "Paz" },
				})
			).id,
		};
		await forUser(me.user.id).apply(setupEnvelopeBook, {
			...setupInput(me),
			timeZone: "UTC",
		});
		envelopes = Object.fromEntries(
			(
				await adminDb.envelope.findMany({
					where: { book: { createdById: me.user.id } },
				})
			).map((e) => [e.name, e.id]),
		);
		project = (
			await adminDb.project.create({
				data: {
					name: "Trip",
					createdById: me.user.id,
					participants: {
						create: [
							{
								participantType: "user",
								participantId: me.user.id,
								role: "ORGANIZER",
							},
							{ participantType: "user", participantId: sam.id },
						],
					},
				},
			})
		).id;
		// S5: an asado USD 90 for three, paid in my Dining; Sam pays his 30 back.
		await split({
			paidBy: meP,
			createdBy: meP,
			amount: 90,
			categoryId: me.dining,
			shares: [
				[meP, 30],
				[samP, 30],
				[paz, 30],
			],
		});
		await pay(samP, meP, 30);
	});

	it("S5 fronted 60, Sam's 30 back: 30 held for Paz, To assign 1,000 - 30, Dining -30", async () => {
		const m = await getMonth(me.user.id);
		expect(m?.toAssign.terms.splitsNet).toEqual(usd(3_000));
		expect(m?.toAssign.amount).toEqual(usd(97_000));
		expect(rowLeft(m, "Dining")).toBe(-3_000);
		expect(m?.owed).toMatchObject({ held: usd(3_000), people: 1 });
	});

	it("the budget's owed equals People's balances when every settlement is FINALIZED", async () => {
		const owed = await getOwed(me.user.id);
		for (const other of [samP, paz]) {
			const people = await computeBalance(
				adminDb,
				{ participantType: "user", participantId: me.user.id },
				{ participantType: other.type, participantId: other.id },
			);
			const line = owed?.people.find((p) => p.participant.id === other.id);
			expect(line?.lines.map((l) => l.amount) ?? []).toEqual(
				Object.entries(people.byCurrency).map(([currency, v]) => ({
					currency,
					minor: Math.round(v * 100),
				})),
			);
		}
		expect(owed?.people.find((p) => p.participant.id === paz.id)?.name).toBe(
			"Paz",
		);
	});

	describe("figure budget.heldForOthers", () => {
		it("reads what the budget holds for money owed to you", async () => {
			const read = await readFigures(me.user.id, ["budget.heldForOthers"]);
			expect(read.get("budget.heldForOthers")).toEqual([usd(3_000)]);
		});
	});

	it("D19 a share in Sam's category is unresolved until you pick; preview writes nothing, undo puts it back", async () => {
		const food = await adminDb.category.create({
			data: { name: "Food", color: "red", userId: sam.id },
		});
		const t = await split({
			paidBy: samP,
			createdBy: samP,
			amount: 40,
			categoryId: food.id,
			shares: [
				[samP, 20],
				[meP, 20],
			],
		});
		const before = await getMonth(me.user.id);
		expect(before?.shares.unresolved).toBe(1);
		expect(rowLeft(before, "Spending")).toBe(-2_000);

		const input = {
			transactionId: t.id,
			categoryId: me.dining,
			source: "USER" as const,
		};
		await forUser(me.user.id).preview(setShareCategoryMutation, input);
		expect((await getMonth(me.user.id))?.shares.unresolved).toBe(1);

		const applied = await forUser(me.user.id).apply(
			setShareCategoryMutation,
			input,
		);
		expect(applied.value.previous).toEqual({ categoryId: null, source: null });
		const after = await getMonth(me.user.id);
		expect(after?.shares.unresolved).toBe(0);
		expect(rowLeft(after, "Dining")).toBe(-5_000);
		expect(after?.toAssign.amount).toEqual(before?.toAssign.amount);

		await forUser(me.user.id).apply(setShareCategoryMutation, {
			transactionId: t.id,
			categoryId: null,
			source: "USER",
		});
		expect((await getMonth(me.user.id))?.shares.unresolved).toBe(1);
		// Leave it placed for the tests below.
		await forUser(me.user.id).apply(setShareCategoryMutation, input);
	});

	it("D19 refuses someone else's category and a split you are not on", async () => {
		const theirs = await adminDb.category.create({
			data: { name: "Theirs", color: "red", userId: sam.id },
		});
		const t = await split({
			paidBy: samP,
			createdBy: samP,
			amount: 10,
			shares: [[meP, 10]],
		});
		const notMine = await split({
			paidBy: samP,
			createdBy: samP,
			amount: 10,
			shares: [[samP, 10]],
		});
		await expect(
			forUser(me.user.id).apply(setShareCategoryMutation, {
				transactionId: t.id,
				categoryId: theirs.id,
				source: "USER",
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			forUser(me.user.id).apply(setShareCategoryMutation, {
				transactionId: notMine.id,
				categoryId: me.dining,
				source: "USER",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		// Clean the unplaced share away so counts below stay simple.
		await adminDb.sharedTransaction.delete({ where: { id: t.id } });
	});

	it("D19 the smart default (a category of the same name, in a shared project) is stored on read", async () => {
		const dining = await adminDb.category.create({
			data: { name: "dining", color: "red", userId: sam.id },
		});
		const t = await split({
			paidBy: samP,
			createdBy: samP,
			amount: 10,
			categoryId: dining.id,
			projectId: project,
			shares: [
				[samP, 5],
				[meP, 5],
			],
		});
		const m = await getMonth(me.user.id);
		expect(rowLeft(m, "Dining")).toBe(-5_500);
		const row = await adminDb.splitParticipant.findFirst({
			where: { transactionId: t.id, participantId: me.user.id },
		});
		expect(row).toMatchObject({
			categoryId: me.dining,
			categorySource: "NAME_MATCH",
		});
	});

	it("D31 a project counted in one envelope, then Not in budget; preview writes nothing; undo sets it back", async () => {
		const base = await getMonth(me.user.id);
		const toRent = {
			projectId: project,
			routing: "ENVELOPE" as const,
			envelopeId: envelopes.Rent as string,
		};
		await forUser(me.user.id).preview(setProjectRoutingMutation, toRent);
		expect(rowLeft(await getMonth(me.user.id), "Rent")).toBe(
			rowLeft(base, "Rent"),
		);

		const applied = await forUser(me.user.id).apply(
			setProjectRoutingMutation,
			toRent,
		);
		expect(applied.value.previous).toEqual({
			routing: "CATEGORY",
			envelopeId: null,
		});
		const routed = await getMonth(me.user.id);
		expect(rowLeft(routed, "Rent")).toBe((rowLeft(base, "Rent") ?? 0) - 500);
		expect(rowLeft(routed, "Dining")).toBe(
			(rowLeft(base, "Dining") ?? 0) + 500,
		);

		await forUser(me.user.id).apply(setProjectRoutingMutation, {
			projectId: project,
			routing: "NOT_IN_BUDGET",
			envelopeId: null,
		});
		const out = await getMonth(me.user.id);
		expect(rowLeft(out, "Rent")).toBe(rowLeft(base, "Rent"));
		expect(rowLeft(out, "Dining")).toBe((rowLeft(base, "Dining") ?? 0) + 500);
		expect((await getOwed(me.user.id))?.notInBudget).toEqual([
			{ projectId: project, name: "Trip" },
		]);

		await forUser(me.user.id).apply(setProjectRoutingMutation, {
			projectId: project,
			...applied.value.previous,
		});
		expect(rowLeft(await getMonth(me.user.id), "Dining")).toBe(
			rowLeft(base, "Dining"),
		);
	});

	it("D31 only your own membership: a project you are not in is refused", async () => {
		const other = await adminDb.project.create({
			data: { name: "Not mine", createdById: sam.id },
		});
		await expect(
			forUser(me.user.id).apply(setProjectRoutingMutation, {
				projectId: other.id,
				routing: "NOT_IN_BUDGET",
				envelopeId: null,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("C14 forgive Paz's 30 into Dining: preview writes nothing; apply releases 30 and charges Dining; a retry is a no-op; undo takes it back", async () => {
		const before = await getMonth(me.user.id);
		const input = {
			id: randomUUID(),
			participant: paz,
			currency: "USD",
			amountMinor: 3_000,
			envelopeId: envelopes.Dining as string,
		};
		const preview = await forUser(me.user.id).preview(forgiveMutation, input);
		expect(preview.value.charged).toEqual(usd(3_000));
		expect(preview.changes).toContainEqual(
			expect.objectContaining({
				id: "budget.notPlannedYet",
				delta: usd(3_000),
			}),
		);
		await expect(
			adminDb.payment.count({ where: { id: input.id } }),
		).resolves.toBe(0);

		const applied = await forUser(me.user.id).apply(forgiveMutation, input);
		expect(applied.undo).toMatchObject({ mutation: "envelope.unforgive" });
		const after = await getMonth(me.user.id);
		expect(after?.toAssign.amount.minor).toBe(
			(before?.toAssign.amount.minor ?? 0) + 3_000,
		);
		expect(rowLeft(after, "Dining")).toBe(
			(rowLeft(before, "Dining") ?? 0) - 3_000,
		);
		expect(after?.owed.held).toEqual(usd(0));
		const people = await computeBalance(
			adminDb,
			{ participantType: "user", participantId: me.user.id },
			{ participantType: "shadow", participantId: paz.id },
		);
		expect(people.byCurrency).toEqual({});

		await forUser(me.user.id).apply(forgiveMutation, input);
		await expect(
			adminDb.settlement.count({ where: { paymentGroupId: input.id } }),
		).resolves.toBe(1);

		await forUser(me.user.id).apply(unforgiveMutation, { paymentId: input.id });
		expect((await getMonth(me.user.id))?.toAssign.amount).toEqual(
			before?.toAssign.amount,
		);
	});

	it("C14 forgiving more than is owed is refused with what is owed", async () => {
		await expect(
			forUser(me.user.id).apply(forgiveMutation, {
				id: randomUUID(),
				participant: paz,
				currency: "USD",
				amountMinor: 3_001,
				envelopeId: null,
			}),
		).rejects.toMatchObject({ code: "OVER_CAP", availableMinor: 3_000 });
	});

	it("Use my plan with Save it and Next month writes one batch across both months; one undo takes it all back", async () => {
		const read = () =>
			adminDb.budgetMovement.findMany({
				where: { book: { createdById: me.user.id } },
			});
		const before = (await read()).length;
		const plan = await userTransaction(adminDb, me.user.id, (tx) =>
			applyPlanFor(tx, {
				userId: me.user.id,
				incomeExpenseId: "none",
				amount: usd(200_000),
				rest: "NEXT_MONTH",
			}),
		);
		expect(plan.applied).toBe(true);
		expect(plan.restChoice).toBe("NEXT_MONTH");
		const months = new Set(plan.lines.map((l) => l.month));
		expect(months.size).toBe(2);
		const rows = (await read()).filter((r) => r.batchId === plan.batchId);
		expect(rows).toHaveLength(plan.lines.length);
		await userTransaction(adminDb, me.user.id, (tx) =>
			undoPlan(tx, me.user.id, plan.batchId as string),
		);
		const all = await read();
		expect(all.length).toBe(before + 2 * rows.length);
		const mirrored = new Set(all.map((r) => r.revertsId));
		expect(rows.every((r) => mirrored.has(r.id))).toBe(true);
	});
});

describe("D12 deleting a split previews its budget change", () => {
	it("sharedExpense.delete preview: 10 held for Paz comes back to To assign; nothing is written", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const meRef: Party = { type: "user", id: s.user.id };
		const shadow: Party = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: s.user.id, name: "Paz" },
				})
			).id,
		};
		const t = await split({
			paidBy: meRef,
			createdBy: meRef,
			amount: 20,
			categoryId: s.dining,
			shares: [
				[meRef, 10],
				[shadow, 10],
			],
		});
		const preview = await forUser(s.user.id).preview(deleteSharedExpense, {
			id: t.id,
			confirmUnsettled: true,
		});
		expect(preview.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "budget.notPlannedYet",
					delta: usd(1_000),
				}),
				expect.objectContaining({
					id: "budget.heldForOthers",
					delta: usd(-1_000),
				}),
				expect.objectContaining({
					id: "budget.leftToSpend",
					delta: usd(1_000),
				}),
			]),
		);
		await expect(
			adminDb.sharedTransaction.count({ where: { id: t.id } }),
		).resolves.toBe(1);
	});
});

describe("splits_budget migration", () => {
	it("applies twice without error and never re-runs the routing backfill", async () => {
		const { user } = await createTestUser();
		const p = await adminDb.project.create({
			data: {
				name: "Hidden",
				createdById: user.id,
				participants: {
					create: [
						{
							participantType: "user",
							participantId: user.id,
							excludeFromAnalytics: true,
							budgetRouting: "CATEGORY",
						},
					],
				},
			},
		});
		const sql = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261024800000_splits_budget/migration.sql",
			),
			"utf8",
		);
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await client.query(sql);
			await client.query(sql);
		} finally {
			await client.end();
		}
		const row = await adminDb.projectParticipant.findFirst({
			where: { projectId: p.id },
		});
		expect(row?.budgetRouting).toBe("CATEGORY");
	});
});
