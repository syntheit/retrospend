/**
 * Targets, starting money, "Can I afford it?" and unrouted shares on
 * Postgres (stream 2B). USD book. Expected values by hand (minor units):
 *
 * augustBook: starting money 100,000; August assigned Dining 30,000, spent
 * 10,000, September spent 5,000: Dining carries 15,000 into this month; To
 * assign 100,000 - 30,000 = 70,000. Dining's target is Refill 200.00.
 *
 * Target in EUR: "Set aside EUR 100.00 a month" with 0.5 EUR per USD is USD
 * 200.00 (20,000 minor) today; the stored target keeps EUR. The undo writes
 * Refill 200.00 in USD back, column for column. A currency with no rate
 * (XYZ) saves and is flagged incomplete, never valued at 1.
 *
 * Starting money: a Flex book set up without an answer has To assign 0; 250.00
 * confirmed makes it 25,000 and records the answer; the undo opens it again.
 *
 * Afford (Flex): Left to spend 15,000, Not planned yet 70,000. A 10,000 item
 * fits (5,000 left). A 25,000 item is 10,000 over and Not planned yet covers
 * it. An 85,001 item is 70,001 over and nothing covers it. Every dollar, ask
 * about Dining (15,000): a 20,000 item is 5,000 short.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	addRow,
	augustBook,
	invariantAt,
	seedUser,
	setupInput,
} from "./__tests__/pg-fixture";
import { getAfford } from "./afford-read.service";
import { setStyleMutation } from "./book.mutation";
import { addMonths } from "./calendar";
import {
	confirmStartingMoneyMutation,
	setTargetMutation,
	undoChangeMutation,
} from "./crud.mutation";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";
import { setShareCategoryMutation } from "./splits.mutation";
import { getUnroutedShares } from "./unrouted-shares.service";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
type View = Awaited<ReturnType<typeof getMonth>>;
const rowOf = (m: View, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

describe("set a target", () => {
	let b: Awaited<ReturnType<typeof augustBook>>;
	const eur = randomUUID();

	beforeAll(async () => {
		await adminDb.exchangeRate.deleteMany({
			where: { currency: "EUR", type: "official" },
		});
		await adminDb.exchangeRate.create({
			data: {
				date: new Date("2026-01-01T00:00:00Z"),
				currency: "EUR",
				type: "official",
				rate: 0.5,
			},
		});
		b = await augustBook();
		await getMonth(b.user.id);
	});

	afterAll(() =>
		adminDb.exchangeRate.deleteMany({
			where: { currency: "EUR", type: "official" },
		}),
	);

	const input = (over: object = {}) => ({
		id: eur,
		envelopeId: b.diningEnv,
		kind: "MONTHLY" as const,
		target: {
			kind: "MONTHLY" as const,
			amountMinor: 10_000,
			mode: "SET_ASIDE" as const,
			cadence: "MONTH" as const,
			currency: "EUR",
		},
		...over,
	});

	it("a EUR target in a USD book keeps EUR and reads USD 200.00 today", async () => {
		const before = await invariantAt(b.user.id);
		const p = await forUser(b.user.id).preview(setTargetMutation, input());
		expect(p.value).toMatchObject({
			typed: { minor: 10_000, currency: "EUR" },
			inBook: usd(20_000),
			incomplete: false,
			target: {
				kind: "MONTHLY",
				targetAmount: "100",
				targetCurrency: "EUR",
				targetMode: "SET_ASIDE",
				targetStartMonth: current,
			},
			previous: {
				kind: "MONTHLY",
				targetAmount: "200",
				targetCurrency: null,
				targetMode: "REFILL",
			},
		});
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: b.diningEnv } }),
		).resolves.toMatchObject({ targetCurrency: null, targetMode: "REFILL" });

		const a = await forUser(b.user.id).apply(setTargetMutation, input());
		expect(a.value.target).toEqual(p.value.target);
		const m = await getMonth(b.user.id);
		expect(rowOf(m, b.diningEnv)?.target).toMatchObject({
			foreign: { minor: 10_000, currency: "EUR" },
			mode: "SET_ASIDE",
		});
		// Money did not move.
		await expect(invariantAt(b.user.id)).resolves.toEqual(before);
		expect(m?.toAssign.amount).toEqual(usd(70_000));
	});

	it("the undo writes the old target back exactly", async () => {
		await forUser(b.user.id).apply(undoChangeMutation, { id: eur });
		const e = await adminDb.envelope.findUniqueOrThrow({
			where: { id: b.diningEnv },
		});
		expect(e).toMatchObject({
			kind: "MONTHLY",
			targetCurrency: null,
			targetMode: "REFILL",
			targetCadence: "MONTH",
		});
		expect(e.targetAmount?.toString()).toBe("200");
	});

	it("a currency with no rate saves flagged, never valued at 1", async () => {
		const id = randomUUID();
		const a = await forUser(b.user.id).apply(
			setTargetMutation,
			input({
				id,
				target: {
					kind: "MONTHLY",
					amountMinor: 10_000,
					mode: "REFILL",
					cadence: "MONTH",
					currency: "XYZ",
				},
			}),
		);
		expect(a.value).toMatchObject({ inBook: null, incomplete: true });
		await forUser(b.user.id).apply(undoChangeMutation, { id });
	});

	it("a bill needs a due date and Everything else cannot become one; the undo restores the kind", async () => {
		const id = randomUUID();
		const bill = {
			id,
			envelopeId: b.diningEnv,
			kind: "BILL" as const,
			target: {
				kind: "BILL" as const,
				amountMinor: 5_000,
				dueDate: "2027-03-15",
				repeat: "MONTHLY" as const,
			},
		};
		await forUser(b.user.id).apply(setTargetMutation, bill);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: b.diningEnv } }),
		).resolves.toMatchObject({ kind: "BILL", targetRepeat: "MONTHLY" });
		const spending = await adminDb.envelope.findFirstOrThrow({
			where: { bookId: b.bookId, name: "Spending" },
		});
		await expect(
			forUser(b.user.id).preview(setTargetMutation, {
				...bill,
				id: randomUUID(),
				envelopeId: spending.id,
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await forUser(b.user.id).apply(undoChangeMutation, { id });
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: b.diningEnv } }),
		).resolves.toMatchObject({ kind: "MONTHLY", targetRepeat: null });
	});

	it("only the newest change to an envelope can be undone", async () => {
		const first = randomUUID();
		const second = randomUUID();
		await forUser(b.user.id).apply(setTargetMutation, input({ id: first }));
		await forUser(b.user.id).apply(
			setTargetMutation,
			input({
				id: second,
				target: {
					kind: "MONTHLY",
					amountMinor: 30_000,
					mode: "REFILL",
					cadence: "MONTH",
				},
			}),
		);
		await expect(
			forUser(b.user.id).apply(undoChangeMutation, { id: first }),
		).rejects.toMatchObject({ code: "INVALID" });
		await forUser(b.user.id).apply(undoChangeMutation, { id: second });
		await forUser(b.user.id).apply(undoChangeMutation, { id: first });
	});

	it("another person's change is invisible: not found, and no rows through RLS", async () => {
		const other = await seedUser();
		await forUser(other.user.id).apply(setupEnvelopeBook, {
			...setupInput(other),
			timeZone: "UTC",
		});
		await expect(
			forUser(other.user.id).apply(undoChangeMutation, { id: eur }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			userTransaction(adminDb, other.user.id, (tx) =>
				tx.envelopeChange.count({ where: { id: eur } }),
			),
		).resolves.toBe(0);
	});
});

describe("starting money", () => {
	it("confirming 250.00 makes To assign 25,000; the undo opens the question again", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: undefined,
			timeZone: "UTC",
		});
		const book = () =>
			adminDb.budgetBook.findFirstOrThrow({
				where: { createdById: s.user.id },
			});
		expect((await book()).startingMoneyConfirmedAt).toBeNull();
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(0));

		const id = randomUUID();
		const p = await forUser(s.user.id).preview(confirmStartingMoneyMutation, {
			id,
			amountMinor: 25_000,
		});
		expect(p.value.amount).toEqual(usd(25_000));
		expect((await book()).startingMoneyConfirmedAt).toBeNull();

		const a = await forUser(s.user.id).apply(confirmStartingMoneyMutation, {
			id,
			amountMinor: 25_000,
		});
		const b = await book();
		expect(b.startingMoneyConfirmedAt).not.toBeNull();
		expect(b.startingBalanceExpenseId).toBe(a.value.expenseId);
		await expect(
			adminDb.expense.findUniqueOrThrow({
				where: { id: a.value.expenseId as string },
			}),
		).resolves.toMatchObject({
			entryKind: "STARTING_BALANCE",
			direction: "IN",
			amount: new Prisma.Decimal(250),
		});
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(25_000));
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
		await expect(
			forUser(s.user.id).apply(confirmStartingMoneyMutation, {
				id: randomUUID(),
				amountMinor: 1,
			}),
		).rejects.toMatchObject({ code: "INVALID" });

		await forUser(s.user.id).apply(undoChangeMutation, { id });
		const after = await book();
		expect(after).toMatchObject({
			startingMoneyConfirmedAt: null,
			startingBalanceExpenseId: null,
		});
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(0));
	});

	it("books what you have plus what was already spent since the start", async () => {
		// By hand: 153.00 spent before the answer leaves the budget holding -15,300.
		// Having 250.00 now means a money in of 25,000 + 15,300 = 40,300: To assign 40,300,
		// Dining -15,300, and 40,300 - 15,300 = 25,000 held.
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: undefined,
			timeZone: "UTC",
		});
		await addRow(s.user.id, { amount: 153, categoryId: s.dining });
		const id = randomUUID();
		const input = { id, amountMinor: 25_000 };
		const p = await forUser(s.user.id).preview(
			confirmStartingMoneyMutation,
			input,
		);
		expect(p.value).toMatchObject({
			amount: usd(25_000),
			booked: usd(40_300),
			alreadySpent: usd(15_300),
		});
		const a = await forUser(s.user.id).apply(
			confirmStartingMoneyMutation,
			input,
		);
		expect(a.value.since).toBe(p.value.since);
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount).toEqual(usd(40_300));
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
		// What the budget holds is what was said: 40,300 - 15,300.
		expect(sides.budget).toBe(25_000);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: a.value.expenseId as string },
		});
		expect(row.date.toISOString()).toBe(`${p.value.since}T12:00:00.000Z`);
		expect(row.amount.toString()).toBe("403");
		await forUser(s.user.id).apply(undoChangeMutation, { id });
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(0));
	});

	it("less than the budget already holds books the shortfall as an Adjustment, and the undo removes it", async () => {
		// By hand: 500.00 of income in To assign (50,000) and nothing else held; you say you have 100.00.
		// 10,000 - 50,000 = -40,000: an OUT Adjustment of 400.00, To assign 10,000, the answer confirmed.
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: undefined,
			timeZone: "UTC",
		});
		await addRow(s.user.id, { amount: 500, direction: "IN", inType: "INCOME" });
		const id = randomUUID();
		const a = await forUser(s.user.id).apply(confirmStartingMoneyMutation, {
			id,
			amountMinor: 10_000,
		});
		expect(a.value).toMatchObject({
			booked: usd(-40_000),
			alreadySpent: usd(-50_000),
			expenseId: null,
		});
		const adj = await adminDb.expense.findUniqueOrThrow({
			where: { id: a.value.adjustmentId as string },
		});
		expect(adj).toMatchObject({ entryKind: "ADJUSTMENT", direction: "OUT" });
		expect(adj.amount.toString()).toBe("400");
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
		});
		expect(book.startingMoneyConfirmedAt).not.toBeNull();
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(10_000));
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
		expect(sides.budget).toBe(10_000);

		await forUser(s.user.id).apply(undoChangeMutation, { id });
		await expect(
			adminDb.expense.count({ where: { id: adj.id } }),
		).resolves.toBe(0);
		expect(
			(
				await adminDb.budgetBook.findFirstOrThrow({
					where: { createdById: s.user.id },
				})
			).startingMoneyConfirmedAt,
		).toBeNull();
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(50_000));
	});

	it("0 is an answer with no row", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: undefined,
			timeZone: "UTC",
		});
		const a = await forUser(s.user.id).apply(confirmStartingMoneyMutation, {
			id: randomUUID(),
			amountMinor: 0,
		});
		expect(a.value.expenseId).toBeNull();
		const b = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
		});
		expect(b.startingMoneyConfirmedAt).not.toBeNull();
	});
});

describe("can I afford it", () => {
	let b: Awaited<ReturnType<typeof augustBook>>;

	beforeAll(async () => {
		b = await augustBook();
		await getMonth(b.user.id);
	});

	const ask = (amountMinor: number, envelopeId?: string) =>
		getAfford(b.user.id, { amountMinor, envelopeId });

	it("Flex: fits, over but covered by Not planned yet, and over with nothing left", async () => {
		const m = await getMonth(b.user.id);
		expect(m?.leftToSpend.left).toEqual(usd(15_000));
		expect(m?.leftToSpend.notPlanned).toEqual(usd(70_000));
		await expect(ask(10_000)).resolves.toMatchObject({
			scope: "SPENDING",
			state: "FITS",
			after: usd(5_000),
			short: usd(0),
			action: null,
		});
		await expect(ask(25_000)).resolves.toMatchObject({
			state: "SHORT_POOL_COVERS",
			short: usd(10_000),
			action: { kind: "ADD_TO_SPENDING", amount: usd(10_000) },
		});
		await expect(ask(85_001)).resolves.toMatchObject({
			state: "SHORT_NOTHING_LEFT",
			short: usd(70_001),
			action: { kind: "PLAN_NEXT_MONTH", month: addMonths(current, 1) },
		});
		// It reads; it writes nothing.
		await expect(
			adminDb.budgetMovement.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(1);
	});

	it("Every dollar: answers from one envelope and offers to move the shortfall", async () => {
		await forUser(b.user.id).apply(setStyleMutation, {
			id: randomUUID(),
			style: "EVERY_DOLLAR",
			leftovers: "KEEP",
		});
		await expect(ask(20_000, b.diningEnv)).resolves.toMatchObject({
			scope: "ENVELOPE",
			state: "SHORT_MOVE",
			envelopeId: b.diningEnv,
			left: usd(15_000),
			short: usd(5_000),
			action: {
				kind: "MOVE_MONEY",
				envelopeId: b.diningEnv,
				amount: usd(5_000),
			},
		});
		await expect(ask(5_000, b.diningEnv)).resolves.toMatchObject({
			state: "FITS",
			after: usd(10_000),
		});
		await expect(ask(5_000, randomUUID())).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("without a budget it answers nothing", async () => {
		const s = await seedUser();
		await expect(
			getAfford(s.user.id, { amountMinor: 1_000 }),
		).resolves.toBeNull();
	});
});

describe("shares with no envelope", () => {
	it("lists a share without a category, ids only, until you pick one", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const paz = await adminDb.shadowProfile.create({
			data: { createdById: s.user.id, name: "Paz" },
		});
		const tx = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: new Prisma.Decimal(80),
				currency: "USD",
				date: new Date(),
				categoryId: null,
				paidByType: "shadow",
				paidById: paz.id,
				createdByType: "shadow",
				createdById: paz.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: s.user.id,
							shareAmount: new Prisma.Decimal(40),
							verificationStatus: "ACCEPTED" as const,
						},
						{
							participantType: "shadow",
							participantId: paz.id,
							shareAmount: new Prisma.Decimal(40),
							verificationStatus: "ACCEPTED" as const,
						},
					],
				},
			},
		});
		const read = await getUnroutedShares(s.user.id, { limit: 100 });
		expect(read).toMatchObject({
			count: 1,
			total: usd(4_000),
			incomplete: false,
			shares: [
				{
					expenseId: tx.id,
					amount: usd(4_000),
					payer: { type: "shadow", id: paz.id },
				},
			],
		});
		const spending = await adminDb.envelope.findFirstOrThrow({
			where: { book: { createdById: s.user.id }, name: "Spending" },
		});
		expect(read?.defaultEnvelopeId).toBe(spending.id);

		await forUser(s.user.id).apply(setShareCategoryMutation, {
			transactionId: tx.id,
			categoryId: s.dining,
			source: "USER",
		});
		await expect(
			getUnroutedShares(s.user.id, { limit: 100 }),
		).resolves.toMatchObject({ count: 0, total: usd(0), shares: [] });
	});
});
