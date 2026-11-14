/**
 * When the undo of a set-up must refuse (BOOK_IN_USE) instead of deleting
 * work the budget now holds, the one lock that keeps a late write from being
 * lost, what the sync log and the keystore see, and the old limits that must
 * not move back in. Flex in ARS as in setup-undo.pg.test.ts: 3 envelopes, 2
 * movements, 1 rule, 1 owner. Every refusal is checked against the tables:
 * the book and its 3 envelopes are still there afterwards.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { openAccount } from "../accounts/test-fixtures";
import { bookStamps } from "../sync/sync-book-test-support";
import { stampOf, until } from "../sync/sync-test-support";
import { addRow } from "./__tests__/pg-fixture";
import {
	arsBlueUser,
	arsFlex,
	counts,
	NO_ROWS,
	type Seeded,
	startBudget,
	undoWith,
} from "./__tests__/setup-undo-fixture";
import { reconcileMutation, setStyleMutation } from "./book.mutation";
import { getWelcomeBack, pause } from "./book-read.service";
import { updateEnvelopeMutation } from "./crud.mutation";
import { budgetMonthOf, isoDateIn } from "./months";
import { assignEnvelopes } from "./movement.mutation";
import { getMonth } from "./read.service";
import { undoSetupEnvelopeBook } from "./setup-undo.mutation";
import { undoSetup } from "./setup-undo.service";
import { touchOpened } from "./welcome.service";

const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);

/** A started Flex budget with the ids a write needs. */
async function started() {
	const s = await arsBlueUser();
	const start = await startBudget(s.user.id, arsFlex(s));
	const envelopes = await adminDb.envelope.findMany({
		where: { bookId: start.bookId },
		orderBy: { sortOrder: "asc" },
	});
	const [rent, dining, spending] = envelopes.map((e) => e.id) as [
		string,
		string,
		string,
	];
	return { s, ...start, rent, dining, spending };
}

type World = Awaited<ReturnType<typeof started>>;

/** The undo answers BOOK_IN_USE naming `part`, and the budget is all still there. */
async function refuses(w: World, part: string) {
	await expect(undoWith(w.s.user.id, w.token)).rejects.toMatchObject({
		code: "BOOK_IN_USE",
		message: expect.stringContaining(part),
	});
	const left = await counts(w.bookId);
	expect(left.budget_book).toBe(1);
	expect(left.envelope).toBe(3);
	expect(left.envelope_group).toBe(2);
}

describe("the budget holds work of its own", () => {
	it("an assign", async () => {
		const w = await started();
		await forUser(w.s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: current,
			mode: "add",
			items: [
				{ id: randomUUID(), envelopeId: w.spending, amountMinor: 10_000 },
			],
		});
		await refuses(w, "budget_movement");
	});

	it("a rename of an envelope", async () => {
		const w = await started();
		await forUser(w.s.user.id).apply(updateEnvelopeMutation, {
			id: randomUUID(),
			envelopeId: w.rent,
			name: "Rent and bills",
		});
		await refuses(w, "envelope");
	});

	it("a style switch", async () => {
		const w = await started();
		await forUser(w.s.user.id).apply(setStyleMutation, {
			id: randomUUID(),
			style: "SAVE_FIRST",
			leftovers: "STYLE_DEFAULT",
		});
		await refuses(w, "budget_book");
	});

	it("Just track (pause)", async () => {
		const w = await started();
		await pause(w.s.user.id);
		await refuses(w, "budget_book");
	});

	it("another member", async () => {
		const w = await started();
		const guest = await createTestUser();
		await fixtureDb.budgetMember.create({
			data: { bookId: w.bookId, userId: guest.user.id, role: "EDITOR" },
		});
		await refuses(w, "budget_member");
	});

	it("an edit of the starting balance expense", async () => {
		const w = await started();
		await fixtureDb.expense.update({
			where: { id: w.expenseId as string },
			data: { excludeFromAnalytics: true },
		});
		await refuses(w, "expense");
	});

	it("a write from a second client, naming its table", async () => {
		const w = await started();
		await adminDb.incomeRule.create({
			data: {
				id: randomUUID(),
				bookId: w.bookId,
				sortOrder: 5,
				name: "Second client",
				action: "REMAINDER",
				envelopeId: w.rent,
			},
		});
		await refuses(w, "income_rule");
	});

	it("a reconcile, which writes an Adjustment dated after the start", async () => {
		const w = await started();
		await forUser(w.s.user.id).apply(reconcileMutation, {
			id: randomUUID(),
			bankMinor: 190_000,
		});
		await refuses(w, "entries");
	});

	it("income a rule matched", async () => {
		const w = await started();
		await addRow(w.s.user.id, {
			amount: 1_000,
			direction: "IN",
			inType: "INCOME",
		});
		// Every page read runs the rules over money in it has not seen.
		await getMonth(w.s.user.id);
		await refuses(w, "income_rule_run");
	});

	it("something that moved between the preview and the apply", async () => {
		const w = await started();
		const preview = await forUser(w.s.user.id).preview(undoSetupEnvelopeBook, {
			token: w.token,
		});
		expect(preview.value.bookId).toBe(w.bookId);
		await forUser(w.s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: current,
			mode: "add",
			items: [{ id: randomUUID(), envelopeId: w.dining, amountMinor: 1_000 }],
		});
		await refuses(w, "budget_movement");
		expect((await counts(w.bookId)).budget_movement).toBe(3);
	});
});

describe("something elsewhere points at the budget", () => {
	it("a forgive charged to an envelope", async () => {
		const w = await started();
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: (await createTestUser()).user.id,
				toParticipantType: "user",
				toParticipantId: w.s.user.id,
				amount: "10",
				currency: "ARS",
				kind: "FORGIVE",
				forgiveEnvelopeId: w.dining,
			},
		});
		await refuses(w, "points at it");
	});

	it("a project counted in one envelope", async () => {
		const w = await started();
		const project = await adminDb.project.create({
			data: { name: "Flat", createdById: w.s.user.id, primaryCurrency: "ARS" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: w.s.user.id,
				role: "ORGANIZER",
				budgetRouting: "ENVELOPE",
				budgetEnvelopeId: w.rent,
			},
		});
		await refuses(w, "points at it");
	});

	it("an expense charged to an envelope", async () => {
		const w = await started();
		const row = await addRow(w.s.user.id, { amount: 5 });
		await fixtureDb.expense.update({
			where: { id: row.id },
			data: { budgetEnvelopeId: w.spending },
		});
		await refuses(w, "points at it");
	});

	it("an account leg of the starting balance", async () => {
		const w = await started();
		const cash = await openAccount(w.s.user.id, "Cash", "CASH", "ARS", 0);
		await adminDb.accountLeg.create({
			data: {
				userId: w.s.user.id,
				accountId: cash,
				currency: "ARS",
				amount: "2000",
				date: new Date(),
				source: "INCOME",
				expenseId: w.expenseId,
			},
		});
		await refuses(w, "points at it");
	});

	it("a child of the starting balance", async () => {
		const w = await started();
		const row = await addRow(w.s.user.id, { amount: 5 });
		await fixtureDb.expense.update({
			where: { id: row.id },
			data: { parentId: w.expenseId },
		});
		await refuses(w, "points at it");
	});

	it("a transfer fee booked as the starting balance", async () => {
		const w = await started();
		await adminDb.transfer.create({
			data: {
				userId: w.s.user.id,
				kind: "TRANSFER",
				date: new Date(),
				fromAmount: "1",
				fromCurrency: "ARS",
				toAmount: "1",
				toCurrency: "ARS",
				feeExpenseId: w.expenseId,
			},
		});
		await refuses(w, "points at it");
	});
});

describe("the old limits are still waiting to move in", () => {
	it("refuses while they would come back behind a no-budget answer", async () => {
		const w = await started();
		await adminDb.budget.create({
			data: {
				userId: w.s.user.id,
				categoryId: w.s.dining,
				amount: "10",
				currency: "USD",
				type: "FIXED",
				period: new Date(Date.UTC(2026, 10, 1)),
			},
		});
		await refuses(w, "old limits");
		await expect(
			adminDb.budget.count({ where: { userId: w.s.user.id } }),
		).resolves.toBe(1);
	});
});

describe("a write that lands while the undo runs", () => {
	/** Runs `write` in a transaction it keeps open while the undo starts, then lets it commit. */
	async function racing(
		w: World,
		write: (
			tx: Parameters<Parameters<typeof userTransaction>[2]>[0],
		) => Promise<unknown>,
	) {
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let written!: () => void;
		const wrote = new Promise<void>((r) => {
			written = r;
		});
		const writer = userTransaction(adminDb, w.s.user.id, async (tx) => {
			await write(tx);
			written();
			await gate;
		});
		await wrote;
		let settled = false;
		const undo = undoWith(w.s.user.id, w.token).then(
			() => "undone" as const,
			(error: unknown) => error,
		);
		void undo.then(() => {
			settled = true;
		});
		await new Promise((r) => setTimeout(r, 600));
		// The undo is waiting for the writer, not finished around it.
		expect(settled).toBe(false);
		release();
		await writer;
		return undo;
	}

	it("an envelope edited in place is not deleted behind its writer's back", async () => {
		const w = await started();
		const outcome = await racing(w, (tx) =>
			tx.envelope.update({ where: { id: w.rent }, data: { name: "Renamed" } }),
		);
		expect(outcome).toMatchObject({ code: "BOOK_IN_USE" });
		expect((await counts(w.bookId)).envelope).toBe(3);
	});

	it("a movement inserted into the book makes it refuse", async () => {
		const w = await started();
		const outcome = await racing(w, (tx) =>
			tx.budgetMovement.create({
				data: {
					id: randomUUID(),
					bookId: w.bookId,
					month: current,
					toEnvelopeId: w.spending,
					amount: "10",
					kind: "ASSIGN",
					actorUserId: w.s.user.id,
				},
			}),
		);
		expect(outcome).toMatchObject({ code: "BOOK_IN_USE" });
		expect((await counts(w.bookId)).budget_movement).toBe(3);
	});
});

describe("what the sync log and the keystore see", () => {
	it("stamps every row of the book and the starting balance D, and leaves other rows alone", async () => {
		const s: Seeded = await arsBlueUser();
		const earlier = await addRow(
			s.user.id,
			{ amount: 50 },
			new Date(Date.now() - 60 * 86_400_000),
		);
		const start = await startBudget(s.user.id, arsFlex(s));
		const ids = [
			["budget_book", [start.bookId]],
			[
				"envelope_group",
				(
					await adminDb.envelopeGroup.findMany({
						where: { bookId: start.bookId },
					})
				).map((r) => r.id),
			],
			[
				"envelope",
				(
					await adminDb.envelope.findMany({ where: { bookId: start.bookId } })
				).map((r) => r.id),
			],
			[
				"envelope_category",
				(
					await adminDb.envelopeCategory.findMany({
						where: { bookId: start.bookId },
					})
				).map((r) => r.id),
			],
			[
				"budget_movement",
				(
					await adminDb.budgetMovement.findMany({
						where: { bookId: start.bookId },
					})
				).map((r) => r.id),
			],
			[
				"book_period",
				(
					await adminDb.bookPeriod.findMany({ where: { bookId: start.bookId } })
				).map((r) => r.id),
			],
			[
				"income_rule",
				(
					await adminDb.incomeRule.findMany({ where: { bookId: start.bookId } })
				).map((r) => r.id),
			],
		] as const;
		// 1 book + 2 groups + 3 envelopes + 2 links + 2 movements + 1 period + 1 rule.
		expect(ids.flatMap(([, list]) => list)).toHaveLength(12);
		await undoWith(s.user.id, start.token);

		const expected = ids
			.flatMap(([entity, list]) => list.map((id) => `${entity}:${id}:D`))
			.sort();
		const stamps = await until(
			() => bookStamps(s.user.id),
			(rows) => rows.length === 12 && rows.every((r) => r.endsWith(":D")),
		);
		expect(stamps).toEqual(expected);
		const gone = await until(
			() => stampOf(s.user.id, "expense", start.expenseId as string),
			(row) => row?.op === "D",
		);
		expect(gone?.op).toBe("D");
		expect((await stampOf(s.user.id, "expense", earlier.id))?.op).toBe("U");
	});

	it("mints no key", async () => {
		const s = await arsBlueUser();
		const start = await startBudget(s.user.id, arsFlex(s));
		const keys = async () => {
			const [row] = await adminDb.$queryRaw<{ n: bigint; m: bigint }[]>`
				SELECT (SELECT count(*) FROM keystore."user_data_key" WHERE "userId" = ${s.user.id}) AS n,
				       (SELECT count(*) FROM keystore."instance_text_key") AS m`;
			return row;
		};
		const before = await keys();
		await undoWith(s.user.id, start.token);
		expect(await keys()).toEqual(before);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
	});
});

describe("a read that meets the undo", () => {
	it("Welcome back answers null once there is no budget, and a page open writes nothing", async () => {
		const w = await started();
		expect(await getWelcomeBack(w.s.user.id)).toMatchObject({
			pending: false,
			months: [],
		});
		await undoWith(w.s.user.id, w.token);
		expect(await getWelcomeBack(w.s.user.id)).toBeNull();
		await expect(
			userTransaction(adminDb, w.s.user.id, (tx) =>
				touchOpened(tx, w.s.user.id, new Date()),
			),
		).resolves.toBeUndefined();
	});

	it("a page open blocked on the undo finds the book gone and is no error", async () => {
		const w = await started();
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let deleted!: () => void;
		const done = new Promise<void>((r) => {
			deleted = r;
		});
		// The undo's transaction holds the deleted book open.
		const undo = userTransaction(adminDb, w.s.user.id, async (tx) => {
			await undoSetup(tx, w.s.user.id, { token: w.token });
			deleted();
			await gate;
		});
		await done;
		// It still sees the book (the delete is not committed), then waits for the row.
		let settled = false;
		const open = userTransaction(adminDb, w.s.user.id, (tx) =>
			touchOpened(tx, w.s.user.id, new Date()),
		).finally(() => {
			settled = true;
		});
		await new Promise((r) => setTimeout(r, 600));
		expect(settled).toBe(false);
		release();
		await undo;
		await expect(open).resolves.toBeUndefined();
		expect((await counts(w.bookId)).budget_book).toBe(0);
	});
});
