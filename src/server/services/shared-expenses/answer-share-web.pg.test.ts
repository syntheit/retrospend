/**
 * The web's accept and reject (answer-share-web.mutation.ts), on real
 * Postgres: the preview writes nothing and says what the save does, a save
 * appends exactly one event and carries a signed undo, and the undo takes
 * the answer back only for the person it was signed for.
 *
 * Ana (home ARS) paid BRL 600 and split it 200 each with Bruno (home ARS) and
 * Caro. ARS official is 1,000 per USD and BRL official is 5 per USD, so
 * Bruno's BRL 200 is USD 40 and ARS 40,000: 4,000,000 minor units.
 */

import { dayKey } from "@retrospend/domain/time-zone";
import type { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { problemCode } from "~/server/api/error-formatter";
import { verificationRouter } from "~/server/api/routers/verification";
import { createCallerFactory } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { RESTORE_TTL_MS, signRestore } from "../entry/restore-token";
import { owedRead } from "../payments/figures";
import { forUser } from "../preview";
import { namedUser, type TestUser } from "../project/__tests__/trip-fixture";
import { ShareAnswerRefusedError } from "./answer-guard";
import {
	ANSWER_RESTORE,
	answerShareWebMutation,
	restoreAnswerWebMutation,
} from "./answer-share-web.mutation";

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);

beforeAll(async () => {
	for (const [currency, rate] of [
		["ARS", "1000"],
		["BRL", "5"],
	] as const)
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: { date: today, currency, type: "official" },
			},
			create: { date: today, currency, type: "official", rate },
			update: { rate },
		});
});

async function scene(opts: { locked?: boolean } = {}) {
	const ana = await namedUser("Ana");
	const bruno = await namedUser("Bruno");
	const caro = await namedUser("Caro");
	for (const u of [ana, bruno, caro])
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	const expense = await fixtureDb.sharedTransaction.create({
		data: {
			description: "Hospedagem",
			amount: "600",
			currency: "BRL",
			date: new Date("2026-10-08"),
			isLocked: opts.locked ?? false,
			paidByType: "user",
			paidById: ana.user.id,
			createdByType: "user",
			createdById: ana.user.id,
			splitParticipants: {
				create: [
					{ who: ana, status: "ACCEPTED" },
					{ who: bruno, status: "PENDING" },
					{ who: caro, status: "PENDING" },
				].map(({ who, status }) => ({
					participantType: "user",
					participantId: who.user.id,
					shareAmount: "200",
					verificationStatus: status as "ACCEPTED" | "PENDING",
				})),
			},
		},
	});
	return { ana, bruno, caro, expense };
}

const input = (
	transactionId: string,
	answer: "accept" | "reject",
	reason?: string,
) => ({ transactionId, answer, reason });

const shareOf = (id: string, u: TestUser) =>
	fixtureDb.splitParticipant.findFirstOrThrow({
		where: { transactionId: id, participantId: u.user.id },
	});

const youOwe = async (u: TestUser) => {
	const owed = await userTransaction(adminDb, u.user.id, (tx) =>
		owedRead(tx, u.user.id),
	);
	return "youOwe" in owed ? owed.youOwe : null;
};

const eventTypes = async (u: TestUser) =>
	(
		await adminDb.apiEvent.findMany({
			where: { userId: u.user.id },
			orderBy: { createdAt: "asc" },
		})
	).map((e) => e.type);

describe("the web answer", () => {
	it("previews a reject without writing, and the save does what the preview said", async () => {
		const { bruno, expense } = await scene();
		const run = forUser(bruno.user.id);
		expect(await youOwe(bruno)).toBe(4_000_000);

		const preview = await run.preview(
			answerShareWebMutation,
			input(expense.id, "reject"),
		);
		expect(preview.changes.find((c) => c.id === "owed.youOwe")?.delta).toEqual({
			minor: -4_000_000,
			currency: "ARS",
		});
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"PENDING",
		);
		expect(await eventTypes(bruno)).toEqual([]);
		// A dry run has nothing to take back: no token in it.
		expect(preview.value.restore).toBeNull();
		expect(preview.value).not.toHaveProperty("was");

		const done = await run.apply(
			answerShareWebMutation,
			input(expense.id, "reject"),
		);
		expect(done.changes).toEqual(preview.changes);
		expect(done.value.restore).not.toBeNull();
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"REJECTED",
		);
		expect(await youOwe(bruno)).toBe(0);
		expect(await eventTypes(bruno)).toEqual(["shared_expense.rejected"]);
	});

	it("previews an accept as no change, saves it with one accepted event", async () => {
		const { bruno, expense } = await scene();
		const run = forUser(bruno.user.id);
		const preview = await run.preview(
			answerShareWebMutation,
			input(expense.id, "accept"),
		);
		expect(preview.changes).toEqual([]);
		expect(await eventTypes(bruno)).toEqual([]);

		const done = await run.apply(
			answerShareWebMutation,
			input(expense.id, "accept"),
		);
		expect(done.value.changed).toBe(true);
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"ACCEPTED",
		);
		expect(await eventTypes(bruno)).toEqual(["shared_expense.accepted"]);
		expect(await youOwe(bruno)).toBe(4_000_000);
	});

	it("stores the reason as typed, spaces and all", async () => {
		const { bruno, expense } = await scene();
		const reason = "  No era mío  ";
		await forUser(bruno.user.id).apply(
			answerShareWebMutation,
			input(expense.id, "reject", reason),
		);
		expect((await shareOf(expense.id, bruno)).rejectionReason).toBe(reason);
	});

	it("gives no token when the share already read the answer", async () => {
		const { bruno, expense } = await scene();
		const run = forUser(bruno.user.id);
		await run.apply(answerShareWebMutation, input(expense.id, "reject"));
		const again = await run.apply(
			answerShareWebMutation,
			input(expense.id, "reject"),
		);
		expect(again.value.changed).toBe(false);
		expect(again.value.restore).toBeNull();
		expect(await eventTypes(bruno)).toHaveLength(2);
	});

	it("refuses a settled expense in the preview, with its problem code, and writes nothing", async () => {
		const { bruno, expense } = await scene({ locked: true });
		const error = await forUser(bruno.user.id)
			.preview(answerShareWebMutation, input(expense.id, "reject"))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShareAnswerRefusedError);
		expect((error as ShareAnswerRefusedError).problem).toBe("share_locked");
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"PENDING",
		);
		expect(await eventTypes(bruno)).toEqual([]);
	});
});

describe("the web undo", () => {
	async function rejected() {
		const s = await scene();
		const done = await forUser(s.bruno.user.id).apply(
			answerShareWebMutation,
			input(s.expense.id, "reject", "no era mío"),
		);
		const restore = done.value.restore;
		if (!restore) throw new Error("a changed answer carries its undo");
		return { ...s, restore };
	}

	it("puts the share and You owe back, and appends one undone event", async () => {
		const { bruno, expense, restore } = await rejected();
		const run = forUser(bruno.user.id);
		const preview = await run.preview(restoreAnswerWebMutation, { restore });
		expect(preview.changes.find((c) => c.id === "owed.youOwe")?.delta).toEqual({
			minor: 4_000_000,
			currency: "ARS",
		});
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"REJECTED",
		);

		await run.apply(restoreAnswerWebMutation, { restore });
		const share = await shareOf(expense.id, bruno);
		expect(share.verificationStatus).toBe("PENDING");
		expect(share.verifiedAt).toBeNull();
		expect(share.rejectionReason).toBeNull();
		expect(await youOwe(bruno)).toBe(4_000_000);
		expect(await eventTypes(bruno)).toEqual([
			"shared_expense.rejected",
			"shared_expense.undone",
		]);
	});

	it("refuses another person's token, another kind, an expired one and a forged one", async () => {
		const { ana, bruno, expense, restore } = await rejected();
		const payload = JSON.parse(restore.data).payload;
		const as = (u: TestUser, token: typeof restore) => () =>
			forUser(u.user.id).apply(restoreAnswerWebMutation, { restore: token });
		const attempts = {
			"another user": as(ana, restore),
			"another kind": as(
				bruno,
				signRestore("expense.restore", bruno.user.id, payload),
			),
			expired: as(
				bruno,
				signRestore(
					ANSWER_RESTORE,
					bruno.user.id,
					payload,
					Date.now() - RESTORE_TTL_MS - 1000,
				),
			),
			forged: as(bruno, { ...restore, sig: "0".repeat(64) }),
		};
		for (const [name, attempt] of Object.entries(attempts))
			await expect(attempt(), name).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"REJECTED",
		);
	});

	it("refuses a replay once the share was answered again", async () => {
		const { bruno, expense, restore } = await rejected();
		const run = forUser(bruno.user.id);
		await run.apply(restoreAnswerWebMutation, { restore });
		await run.apply(answerShareWebMutation, input(expense.id, "accept"));
		await expect(
			run.apply(restoreAnswerWebMutation, { restore }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"ACCEPTED",
		);
	});

	it("refuses to take an answer back once the expense is settled", async () => {
		const { bruno, expense, restore } = await rejected();
		await adminDb.sharedTransaction.update({
			where: { id: expense.id },
			data: { isLocked: true },
		});
		await expect(
			forUser(bruno.user.id).preview(restoreAnswerWebMutation, { restore }),
		).rejects.toMatchObject({ problem: "share_locked" });
	});
});

describe("through verification.answer and verification.restoreAnswer", () => {
	const caller = (u: TestUser | null) =>
		createCallerFactory(verificationRouter)({
			db: adminDb,
			session: u
				? ({
						user: {
							id: u.user.id,
							role: u.user.role,
							email: u.user.email,
							name: u.user.name,
							isActive: true,
						},
					} as never)
				: null,
			headers: new Headers(),
		});

	it("previews, saves and undoes a reject over the procedures the sheet calls", async () => {
		const { bruno, expense } = await scene();
		const api = caller(bruno);
		const dry = await api.answer.preview({
			txnId: expense.id,
			answer: "reject",
		});
		expect(dry.value.restore).toBeNull();
		const done = await api.answer.save({
			txnId: expense.id,
			answer: "reject",
			reason: "  no era mío ",
		});
		expect(done.changes).toEqual(dry.changes);
		const restore = done.value.restore;
		if (!restore) throw new Error("a changed answer carries its undo");
		expect((await shareOf(expense.id, bruno)).rejectionReason).toBe(
			"  no era mío ",
		);
		await api.restoreAnswer.save({ restore });
		expect((await shareOf(expense.id, bruno)).verificationStatus).toBe(
			"PENDING",
		);
		expect(await eventTypes(bruno)).toEqual([
			"shared_expense.rejected",
			"shared_expense.undone",
		]);
	});

	it("sends a refusal as a problem code, which the sheet turns into its sentence", async () => {
		const { bruno, expense } = await scene({ locked: true });
		const error = await caller(bruno)
			.answer.preview({ txnId: expense.id, answer: "accept" })
			.catch((e: unknown) => e);
		expect(problemCode(error as TRPCError)).toBe("share_locked");
	});

	it("takes no answer without a signed-in user", async () => {
		const { expense } = await scene();
		await expect(
			caller(null).answer.save({ txnId: expense.id, answer: "accept" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
