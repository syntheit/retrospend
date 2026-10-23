/**
 * The P4 book writes on Postgres, each with its preview (a dry run that
 * writes nothing) and undo. USD, cents. Expected values by hand:
 *
 * Style switch (SPEC §4.4)
 *   Limits book: Dining 200.00 + Groceries 420.00 funded, To assign -62,000.
 *   Budget holds -62,000 + 62,000 = 0. Switch to Flex with "I have
 *   1,000.00 now": Adjustment +100,000, To assign 38,000; every Return rule
 *   becomes Carry; plan funding stops. Undo puts all of it back.
 *   Flex fixture (start money 100,000; Rent set aside 500.00, Dining refill
 *   200.00): switch to Limits funds nothing this month (To assign stays
 *   100,000); next month opens with 50,000 + 20,000, To assign 30,000.
 *
 * S26 Welcome back (four months away, no income logged)
 *   start c-4 with 100,000; Dining assigned 90,000, 10,000 spent in c-4;
 *   Everything else spends 15,000 in c-3 and 2,000 in c-1 (overspent).
 *   Today: Dining 80,000 carried, To assign 100,000 - 90,000 - 17,000 =
 *   -7,000; the budget holds 73,000. Last open 60 days ago: Welcome back
 *   waits with four closes. Start fresh: RESET 80,000, To assign 73,000.
 *   Set what I have now 500.00: Adjustment -23,000, To assign -30,000.
 *
 * Reconcile (SPEC §5.11)
 *   Flex fixture holds 100,000. Accounts in the budget: cash 950.00, a card
 *   owing 30.00 (counts -3,000); a brokerage is not in it. Bank 92,000,
 *   difference -8,000; recording it: To assign 92,000.
 *
 * C20 start day: from the 1st to the 25th starts with next month's 25th;
 * this month ends the day before; an expense on next month's 3rd now
 * belongs to this month.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import {
	getBankCheck,
	getWelcomeBack,
	pause,
	resume,
	acknowledge,
} from "./book-read.service";
import {
	reconcileMutation,
	removeAdjustmentMutation,
	revertStyleMutation,
	setBookPeriodMutation,
	setStyleMutation,
	welcomeBackMutation,
} from "./book.mutation";
import { addMonths } from "./calendar";
import { budgetMonthOf, isoDateIn } from "./months";
import { undoMovements } from "./movement.mutation";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const day = (m: number, d: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, d, 12));
const iso = (m: number, d: number) => day(m, d).toISOString().slice(0, 10);

async function flexBook() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	return { ...s, book, ids: ids as Record<string, string> };
}

async function limitsBook() {
	const s = await seedUser();
	const input = setupInput(s);
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...input,
		style: "LIMITS",
		startingMoneyMinor: undefined,
		envelopes: input.envelopes.map((e) =>
			e.key === "rent"
				? {
						...e,
						name: "Groceries",
						target: {
							kind: "MONTHLY",
							amountMinor: 42_000,
							mode: "SET_ASIDE",
							cadence: "MONTH",
						},
					}
				: e.key === "dining"
					? {
							...e,
							target: {
								kind: "MONTHLY",
								amountMinor: 20_000,
								mode: "SET_ASIDE",
								cadence: "MONTH",
							},
						}
					: e,
		),
		timeZone: "UTC",
	});
	return s;
}

describe("style switching (SPEC §4.4)", () => {
	it("Limits to Flex: one Adjustment makes To assign what you have minus what envelopes hold; undo puts it back", async () => {
		const s = await limitsBook();
		await expect(
			forUser(s.user.id).apply(setStyleMutation, {
				id: randomUUID(),
				style: "FLEX",
				leftovers: "STYLE_DEFAULT",
			}),
		).rejects.toThrow("right now");
		const input = {
			id: randomUUID(),
			style: "FLEX" as const,
			haveNowMinor: 100_000,
			leftovers: "STYLE_DEFAULT" as const,
		};
		const before = await adminDb.expense.count({ where: { userId: s.user.id } });
		const p = await forUser(s.user.id).preview(setStyleMutation, input);
		expect(p.value.adjustment?.amount).toEqual(usd(100_000));
		await expect(
			adminDb.expense.count({ where: { userId: s.user.id } }),
		).resolves.toBe(before);
		const r = await forUser(s.user.id).apply(setStyleMutation, input);
		expect(r.value).toMatchObject({ style: "FLEX", fundingSource: "INCOME" });
		expect(r.value.ruleChanges).toHaveLength(3);
		expect(r.value.ruleChanges.every((c) => c.to === "CARRY")).toBe(true);
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(38_000);
		expect(m?.verdict.lead.kind).toBe("LEFT_TO_SPEND");
		await forUser(s.user.id).apply(revertStyleMutation, {
			previous: r.value.previous,
			adjustmentId: r.value.adjustment?.id ?? null,
		});
		const back = await getMonth(s.user.id);
		expect(back?.toAssign.amount.minor).toBe(-62_000);
		expect(back?.book).toMatchObject({ style: "LIMITS", fundingSource: "TARGETS" });
		const rules = await adminDb.envelope.findMany({
			where: { book: { createdById: s.user.id } },
		});
		expect(rules.every((e) => e.leftoverRule === "RETURN")).toBe(true);
	});

	it("Flex to Limits: nothing moves this month; next month opens with each limit", async () => {
		const s = await flexBook();
		const r = await forUser(s.user.id).apply(setStyleMutation, {
			id: randomUUID(),
			style: "LIMITS",
			leftovers: "STYLE_DEFAULT",
		});
		expect(r.value.fundedFrom).toBe(addMonths(current, 1));
		const now = await getMonth(s.user.id);
		expect(now?.toAssign.amount.minor).toBe(100_000);
		await expect(
			adminDb.budgetMovement.count({
				where: { kind: "PLAN_FUND", bookId: s.book.id },
			}),
		).resolves.toBe(0);
		const next = await getMonth(s.user.id, undefined, day(addMonths(current, 1), 2));
		expect(next?.toAssign.amount.minor).toBe(30_000);
		expect(next?.verdict.lead.kind).toBe("LEFT_IN_LIMITS");
	});
});

describe("S26 Welcome back after four months away", () => {
	const start = addMonths(current, -4);
	let s: Awaited<ReturnType<typeof flexBook>>;

	beforeAll(async () => {
		s = await flexBook();
		await adminDb.budgetBook.update({
			where: { id: s.book.id },
			data: {
				startMonth: start,
				startDate: day(start, 1),
				lastOpenedAt: new Date(Date.now() - 60 * 86_400_000),
			},
		});
		await adminDb.bookPeriod.updateMany({
			where: { bookId: s.book.id },
			data: { fromMonth: start },
		});
		await adminDb.expense.update({
			where: { id: s.book.startingBalanceExpenseId as string },
			data: { date: day(start, 1) },
		});
		await adminDb.budgetMovement.create({
			data: {
				id: randomUUID(),
				bookId: s.book.id,
				month: start,
				toEnvelopeId: s.ids.Dining,
				amount: 900,
				kind: "ASSIGN",
				actorUserId: s.user.id,
			},
		});
		await addRow(s.user.id, { amount: 100, categoryId: s.dining }, day(start, 12));
		await addRow(s.user.id, { amount: 150 }, day(addMonths(start, 1), 12));
		await addRow(s.user.id, { amount: 20 }, day(addMonths(current, -1), 5));
	});

	it("the first open closes four months and Welcome back waits with them", async () => {
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(-7_000);
		const w = await getWelcomeBack(s.user.id);
		expect(w.pending).toBe(true);
		expect(w.months.map((x) => x.month)).toEqual([
			start,
			addMonths(start, 1),
			addMonths(start, 2),
			addMonths(start, 3),
		]);
		expect(w.bank.holds).toEqual(usd(73_000));
	});

	it("Start fresh: one RESET batch returns Dining's 80,000; preview writes nothing; undo puts it back", async () => {
		const input = { choice: "START_FRESH" as const, batchId: randomUUID() };
		const p = await forUser(s.user.id).preview(welcomeBackMutation, input);
		expect(p.value.movements?.toAssign.after).toEqual(usd(73_000));
		await expect(getWelcomeBack(s.user.id)).resolves.toMatchObject({
			pending: true,
		});
		const r = await forUser(s.user.id).apply(welcomeBackMutation, input);
		expect(r.value.movements?.movements).toMatchObject([
			{ kind: "RESET", from: s.ids.Dining, to: null, amount: usd(80_000) },
		]);
		await expect(getWelcomeBack(s.user.id)).resolves.toMatchObject({
			pending: false,
		});
		await forUser(s.user.id).apply(undoMovements, {
			id: randomUUID(),
			target: { batchId: input.batchId },
		});
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(-7_000);
	});

	it("Set what I have now (500.00): an Adjustment of -23,000; envelopes keep what they hold", async () => {
		const r = await forUser(s.user.id).apply(welcomeBackMutation, {
			choice: "SET_HAVE_NOW",
			id: randomUUID(),
			amountMinor: 50_000,
		});
		expect(r.value.adjustment?.amount).toEqual(usd(-23_000));
		expect(r.undo).toMatchObject({ mutation: "envelope.removeAdjustment" });
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(-30_000);
		await forUser(s.user.id).apply(removeAdjustmentMutation, {
			expenseId: r.value.adjustment?.expenseId as string,
		});
		await expect(getMonth(s.user.id)).resolves.toMatchObject({
			toAssign: { amount: usd(-7_000) },
		});
	});

	it("Catch up lists the summaries; acknowledging one takes it off the list", async () => {
		const r = await forUser(s.user.id).apply(welcomeBackMutation, {
			choice: "CATCH_UP",
		});
		expect(r.value.months).toHaveLength(4);
		await acknowledge(s.user.id, { month: start, revision: 1 });
		const w = await getWelcomeBack(s.user.id);
		expect(w.months.map((x) => x.month)).not.toContain(start);
	});

	it("pause hides the budget; resume brings Welcome back", async () => {
		await pause(s.user.id);
		await expect(getMonth(s.user.id)).resolves.toMatchObject({
			book: { paused: true },
		});
		const back = await resume(s.user.id);
		expect(back.welcomeBackFrom).not.toBeNull();
		await expect(getWelcomeBack(s.user.id)).resolves.toMatchObject({
			pending: true,
		});
	});
});

describe("figure budget.holds", () => {
	it("reconcile: bank 92,000 against 100,000 held; recording the difference leaves 92,000", async () => {
		const s = await flexBook();
		const account = (
			name: string,
			type: "CASH" | "LIABILITY_CREDIT_CARD" | "INVESTMENT",
			balance: string,
		) =>
			adminDb.assetAccount.create({
				data: {
					userId: s.user.id,
					name,
					type,
					currency: "USD",
					balance: new Prisma.Decimal(balance),
				},
			});
		await account("Wallet", "CASH", "950");
		await account("Visa", "LIABILITY_CREDIT_CARD", "30");
		await account("Broker", "INVESTMENT", "5000");
		const before = await readFigures(s.user.id, ["budget.holds"]);
		expect(before.get("budget.holds")).toEqual([usd(100_000)]);
		const check = await getBankCheck(s.user.id);
		expect(check).toMatchObject({
			holds: usd(100_000),
			bank: usd(92_000),
			difference: usd(-8_000),
			incomplete: false,
			reconciledAt: null,
		});
		expect(check.accounts.map((a) => a.name)).toEqual(["Visa", "Wallet"]);
		const r = await forUser(s.user.id).apply(reconcileMutation, {
			id: randomUUID(),
			amountMinor: 8_000,
			direction: "OUT",
		});
		expect(r.value.amount).toEqual(usd(-8_000));
		const after = await readFigures(s.user.id, ["budget.holds"]);
		expect(after.get("budget.holds")).toEqual([usd(92_000)]);
		await expect(getBankCheck(s.user.id)).resolves.toMatchObject({
			difference: usd(0),
		});
	});
});

describe("C20 changing the month start day", () => {
	it("from the 1st to the 25th: starts with next month's 25th; this month runs to the 24th; undo removes it", async () => {
		const s = await flexBook();
		const next = addMonths(current, 1);
		await addRow(s.user.id, { amount: 10, categoryId: s.dining }, day(next, 3));
		const before = await getMonth(s.user.id);
		const dining = (m: typeof before) =>
			m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === s.ids.Dining)
				?.activity.minor;
		expect(dining(before)).toBe(0);
		const r = await forUser(s.user.id).apply(setBookPeriodMutation, {
			startDay: 25,
		});
		expect(r.value).toMatchObject({
			fromMonth: next,
			startsOn: iso(next, 25),
			startDay: 25,
			previous: { startDay: 1 },
			currentMonth: { key: current, from: iso(current, 1), to: iso(next, 24) },
		});
		const after = await getMonth(s.user.id);
		expect(after?.month.to).toBe(iso(next, 24));
		expect(dining(after)).toBe(-1_000);
		const undo = await forUser(s.user.id).apply(setBookPeriodMutation, {
			startDay: 1,
		});
		expect(undo.value.periodId).toBeNull();
		await expect(
			adminDb.bookPeriod.count({ where: { bookId: s.book.id } }),
		).resolves.toBe(1);
	});
});
