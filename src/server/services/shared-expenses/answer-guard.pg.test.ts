/**
 * The refusals on answering your own share (answer-guard.ts), on real
 * Postgres: settled, a correction, a reject that would reverse a payment.
 * Each is a ShareAnswerRefusedError with its own problem code, in the preview
 * and in the write, for answering and for taking an answer back. And the
 * reject that is allowed: its preview names the change, and undo restores it.
 *
 * Ana (home ARS) paid ARS 40,000 and split it 20,000 each with Bruno (home
 * USD). ARS blue is 1,500 per USD, so Bruno's ARS 20,000 is USD 13.33 (the
 * rate rounds to the cent: 20,000 / 1,500 = 13.333...).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dayKey } from "@retrospend/domain/time-zone";
import { userTransaction } from "~/server/db-tx";
import { adminDb } from "~/test/pg-harness";
import { owedRead } from "../payments/figures";
import { forUser } from "../preview";
import { namedUser, type TestUser } from "../project/__tests__/trip-fixture";
import { ShareAnswerRefusedError } from "./answer-guard";
import {
	answerShareMutation,
	restoreAnswerMutation,
	type ShareAnswered,
} from "./answer-share.mutation";

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);

beforeAll(async () => {
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: today, currency: "ARS", type: "blue" },
		},
		create: { date: today, currency: "ARS", type: "blue", rate: "1500" },
		update: { rate: "1500" },
	});
});

async function scene(opts: { locked?: boolean; correctsId?: string } = {}) {
	const ana = await namedUser("Ana");
	const bruno = await namedUser("Bruno");
	await adminDb.user.update({
		where: { id: ana.user.id },
		data: { homeCurrency: "ARS" },
	});
	await adminDb.user.update({
		where: { id: bruno.user.id },
		data: { homeCurrency: "USD", defaultRateTypes: { ARS: "blue" } },
	});
	const expense = await seed(ana, bruno, "PENDING", opts);
	return { ana, bruno, expense };
}

async function seed(
	ana: TestUser,
	bruno: TestUser,
	status: "PENDING" | "ACCEPTED",
	opts: { locked?: boolean; correctsId?: string } = {},
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Cena",
			amount: "40000",
			currency: "ARS",
			date: new Date("2026-10-08"),
			isLocked: opts.locked ?? false,
			correctsId: opts.correctsId ?? null,
			paidByType: "user",
			paidById: ana.user.id,
			createdByType: "user",
			createdById: ana.user.id,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: ana.user.id,
						shareAmount: "20000",
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: "user",
						participantId: bruno.user.id,
						shareAmount: "20000",
						verificationStatus: status,
					},
				],
			},
		},
	});
}

const pays = (from: TestUser, to: TestUser, amount: string) =>
	adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: from.user.id,
			toParticipantType: "user",
			toParticipantId: to.user.id,
			amount,
			currency: "ARS",
			status: "FINALIZED",
		},
	});

const answer = (transactionId: string, choice: "accept" | "reject") => ({
	transactionId,
	answer: choice,
});

/** The problem code a refused write and its preview both carry. */
async function refusal(
	u: TestUser,
	transactionId: string,
	choice: "accept" | "reject",
) {
	const codes: string[] = [];
	for (const run of ["preview", "apply"] as const) {
		try {
			await forUser(u.user.id)[run](
				answerShareMutation,
				answer(transactionId, choice),
			);
			codes.push("allowed");
		} catch (e) {
			codes.push(
				e instanceof ShareAnswerRefusedError ? e.problem : `other: ${e}`,
			);
		}
	}
	return codes;
}

const statusOf = async (id: string, u: TestUser) =>
	(
		await adminDb.splitParticipant.findFirstOrThrow({
			where: { transactionId: id, participantId: u.user.id },
		})
	).verificationStatus;

describe("a settled expense takes no answer", () => {
	it("refuses accept and reject, in the preview and the write, and writes nothing", async () => {
		const { bruno, expense } = await scene({ locked: true });
		expect(await refusal(bruno, expense.id, "reject")).toEqual([
			"share_locked",
			"share_locked",
		]);
		expect(await refusal(bruno, expense.id, "accept")).toEqual([
			"share_locked",
			"share_locked",
		]);
		expect(await statusOf(expense.id, bruno)).toBe("PENDING");
	});

	it("still lets an answer that changes nothing through", async () => {
		const { bruno, expense } = await scene({ locked: true });
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: expense.id, participantId: bruno.user.id },
			data: { verificationStatus: "REJECTED" },
		});
		const done = await forUser(bruno.user.id).apply(
			answerShareMutation,
			answer(expense.id, "reject"),
		);
		expect((done.value as ShareAnswered).changed).toBe(false);
	});
});

describe("a correction is undone, not rejected", () => {
	it("refuses a reject on a correction row and on an expense that has corrections", async () => {
		const { ana, bruno, expense } = await scene();
		// A correction of `expense`: its own row with Bruno's share waiting.
		const correction = await seed(ana, bruno, "PENDING", {
			correctsId: expense.id,
		});
		expect(await refusal(bruno, correction.id, "reject")).toEqual([
			"share_is_correction",
			"share_is_correction",
		]);
		expect(await refusal(bruno, expense.id, "reject")).toEqual([
			"share_is_correction",
			"share_is_correction",
		]);
		// Accepting a correction is how it is confirmed: allowed.
		expect(await refusal(bruno, correction.id, "accept")).toEqual([
			"allowed",
			"allowed",
		]);
	});
});

describe("a paid share cannot be rejected into a reverse debt", () => {
	it("refuses a reject once Bruno paid it, and lets the unpaid one through", async () => {
		const { ana, bruno, expense } = await scene();
		await pays(bruno, ana, "20000");
		expect(await refusal(bruno, expense.id, "reject")).toEqual([
			"share_reject_reverses_payment",
			"share_reject_reverses_payment",
		]);
		expect(await statusOf(expense.id, bruno)).toBe("PENDING");
		// Another expense he has not paid: erasing that debt is the point.
		const unpaid = await seed(ana, bruno, "PENDING");
		expect(await refusal(bruno, unpaid.id, "reject")).toEqual([
			"allowed",
			"allowed",
		]);
	});

	it("refuses taking an accept back into a rejection once the share was paid", async () => {
		const { ana, bruno, expense } = await scene();
		const run = forUser(bruno.user.id);
		await run.apply(answerShareMutation, answer(expense.id, "reject"));
		const accepted = await run.apply(
			answerShareMutation,
			answer(expense.id, "accept"),
		);
		// Now the share counts and he pays it; the undo would put it back to
		// REJECTED and leave Ana owing him the 20,000.
		await pays(bruno, ana, "20000");
		const was = (accepted.value as ShareAnswered).was;
		await expect(
			run.apply(restoreAnswerMutation, {
				transactionId: expense.id,
				answer: "accept",
				was,
			}),
		).rejects.toMatchObject({ problem: "share_reject_reverses_payment" });
		expect(await statusOf(expense.id, bruno)).toBe("ACCEPTED");
	});
});

describe("the reject that is allowed", () => {
	it("previews Bruno's You owe falling to 0, writes it, and undo puts it back", async () => {
		const { bruno, expense } = await scene();
		const owed = async () =>
			userTransaction(adminDb, bruno.user.id, (tx) =>
				owedRead(tx, bruno.user.id),
			);
		// ARS 20,000 at 1,500 per USD is USD 13.33 (1,333 cents, rounded once).
		expect(await owed()).toMatchObject({ youOwe: 1_333, currency: "USD" });

		const run = forUser(bruno.user.id);
		const input = answer(expense.id, "reject");
		const preview = await run.preview(answerShareMutation, input);
		expect(
			preview.changes.find((c) => c.id === "owed.youOwe")?.delta,
		).toEqual({ minor: -1_333, currency: "USD" });
		expect(await statusOf(expense.id, bruno)).toBe("PENDING");

		const done = await run.apply(answerShareMutation, input);
		expect(await owed()).toMatchObject({ youOwe: 0 });
		await run.apply(restoreAnswerMutation, {
			transactionId: expense.id,
			answer: "reject",
			was: (done.value as ShareAnswered).was,
		});
		expect(await owed()).toMatchObject({ youOwe: 1_333 });
	});
});
