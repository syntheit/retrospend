/**
 * Month close and Wealth moves on a real Postgres (P4), through RLS: the
 * lazy close on first read (concurrent reads close each month once), rule
 * snapshots, Limits plan funding once, carry an overspend / fix a negative
 * To assign / start fresh with preview and undo, the budget side of Wealth
 * moves and what deletes it, and the month_close_wealth migration applied
 * twice. USD book; amounts in minor units.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import {
	recordBudgetSide,
	removeBudgetSide,
} from "~/server/services/transfers/budget-side";
import { adminDb } from "~/test/pg-harness";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import {
	carryOverspendMutation,
	fixNegativeMutation,
	resetEnvelopesMutation,
} from "./close.mutation";
import { budgetMonthOf, isoDateIn } from "./months";
import { assignEnvelopes, undoMovements } from "./movement.mutation";
import { getMonth, getMonthSummary } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const firstDay = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 1));
const midMonth = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 12, 12));

/** A USD Flex book that started two months ago: Dining +30,000 and 10,000 spent then, 5,000 unplanned spending last month. */
async function bookTwoMonthsBack(funding: "INCOME" | "TARGETS" = "INCOME") {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const start = addMonths(current, -2);
	await adminDb.budgetBook.update({
		where: { id: book.id },
		data: {
			startMonth: start,
			startDate: firstDay(start),
			fundingSource: funding,
		},
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { fromMonth: start },
	});
	if (book.startingBalanceExpenseId)
		await adminDb.expense.update({
			where: { id: book.startingBalanceExpenseId },
			data: { date: firstDay(start) },
		});
	const ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	if (funding === "INCOME")
		await adminDb.budgetMovement.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				month: start,
				toEnvelopeId: ids.Dining,
				amount: 300,
				kind: "ASSIGN",
				actorUserId: s.user.id,
			},
		});
	await addRow(
		s.user.id,
		{ amount: 100, categoryId: s.dining },
		midMonth(start),
	);
	await addRow(s.user.id, { amount: 50 }, midMonth(addMonths(current, -1)));
	return { ...s, bookId: book.id, ids: ids as Record<string, string> };
}

const left = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left.minor;

describe("lazy month close on Postgres", () => {
	let b: Awaited<ReturnType<typeof bookTwoMonthsBack>>;

	beforeAll(async () => {
		b = await bookTwoMonthsBack();
	});

	it("concurrent first reads close the two months before this one exactly once", async () => {
		await Promise.all(Array.from({ length: 5 }, () => getMonth(b.user.id)));
		const rows = await adminDb.monthClose.findMany({
			where: { bookId: b.bookId },
			orderBy: { month: "asc" },
		});
		expect(rows.map((r) => r.month)).toEqual([
			addMonths(current, -2),
			addMonths(current, -1),
		]);
	});

	it("each summary says what the month ended with and the rule it closed under", async () => {
		const first = await getMonthSummary(b.user.id, addMonths(current, -2));
		expect(first?.envelopes.find((e) => e.id === b.ids.Dining)).toMatchObject({
			assigned: 30_000,
			activity: -10_000,
			left: 20_000,
			rule: "CARRY",
			carried: 20_000,
		});
		const last = await getMonthSummary(b.user.id, addMonths(current, -1));
		expect(last?.overspent).toBe(5_000);
		await expect(getMonthSummary(b.user.id, current)).resolves.toBeNull();
	});

	it("a leftover rule changed after the close applies from the next close only (B7)", async () => {
		await adminDb.envelope.update({
			where: { id: b.ids.Dining },
			data: { leftoverRule: "RETURN" },
		});
		const m = await getMonth(b.user.id);
		// 20,000 carried through both closed months under Carry.
		expect(left(m, b.ids.Dining as string)).toBe(20_000);
		await adminDb.envelope.update({
			where: { id: b.ids.Dining },
			data: { leftoverRule: "CARRY" },
		});
	});

	it("carry last month's overspend into this month's Spending: preview writes nothing, cap, undo", async () => {
		const before = await getMonth(b.user.id);
		const input = {
			id: randomUUID(),
			envelopeId: b.ids.Spending as string,
			amountMinor: 5_000,
		};
		const preview = await forUser(b.user.id).preview(
			carryOverspendMutation,
			input,
		);
		expect(
			preview.value.toAssign.after.minor - preview.value.toAssign.before.minor,
		).toBe(5_000);
		expect((await getMonth(b.user.id))?.toAssign).toEqual(before?.toAssign);

		const applied = await forUser(b.user.id).apply(
			carryOverspendMutation,
			input,
		);
		const after = await getMonth(b.user.id);
		expect(after?.toAssign.amount.minor).toBe(
			(before?.toAssign.amount.minor ?? 0) + 5_000,
		);
		expect(left(after, b.ids.Spending as string)).toBe(-5_000);
		await expect(
			forUser(b.user.id).apply(carryOverspendMutation, {
				...input,
				id: randomUUID(),
				amountMinor: 1,
			}),
		).rejects.toMatchObject({ code: "OVER_CAP", availableMinor: 0 });

		await forUser(b.user.id).apply(undoMovements, {
			id: randomUUID(),
			target: { movementId: applied.value.movements[0]?.id as string },
		});
		expect((await getMonth(b.user.id))?.toAssign).toEqual(before?.toAssign);
	});

	it("fix a negative To assign from the envelopes holding the most, back to exactly 0", async () => {
		const m = await getMonth(b.user.id);
		const over = (m?.toAssign.amount.minor ?? 0) + 7_000;
		await forUser(b.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: current,
			mode: "add",
			items: [
				{
					id: randomUUID(),
					envelopeId: b.ids.Rent as string,
					amountMinor: over,
				},
			],
		});
		expect((await getMonth(b.user.id))?.toAssign.amount).toEqual(usd(-7_000));
		const fixed = await forUser(b.user.id).apply(fixNegativeMutation, {
			batchId: randomUUID(),
		});
		expect(fixed.value.toAssign.after).toEqual(usd(0));
		expect((await getMonth(b.user.id))?.toAssign.amount).toEqual(usd(0));
	});

	it("start fresh: every envelope's Left goes to 0 through To assign; one undo puts it back", async () => {
		const before = await getMonth(b.user.id);
		const batchId = randomUUID();
		await forUser(b.user.id).apply(resetEnvelopesMutation, { batchId });
		const after = await getMonth(b.user.id);
		expect(
			after?.groups
				.flatMap((g) => g.envelopes)
				.every((e) => e.left.minor === 0),
		).toBe(true);
		expect(after?.toAssign.amount.minor).toBe(
			(before?.toAssign.amount.minor ?? 0) +
				(before?.groups
					.flatMap((g) => g.envelopes)
					.reduce((t, e) => t + e.left.minor, 0) ?? 0),
		);
		await forUser(b.user.id).apply(undoMovements, {
			id: randomUUID(),
			target: { batchId },
		});
		expect((await getMonth(b.user.id))?.toAssign).toEqual(before?.toAssign);
	});

	it("RLS: another user reads none of this book's closes and cannot write its Wealth moves", async () => {
		const other = await seedUser();
		await expect(
			other.db.monthClose.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(0);
		await expect(
			other.db.wealthTransfer.create({
				data: {
					id: randomUUID(),
					bookId: b.bookId,
					direction: "FROM_WEALTH",
					date: new Date(),
					amount: 1,
					actorUserId: other.user.id,
				},
			}),
		).rejects.toThrow();
	});
});

describe("Limits plan funding on Postgres", () => {
	it("concurrent first reads of the month write one PLAN_FUND batch with every target's need", async () => {
		const b = await bookTwoMonthsBack("TARGETS");
		await Promise.all(Array.from({ length: 5 }, () => getMonth(b.user.id)));
		const rows = await adminDb.budgetMovement.findMany({
			where: { bookId: b.bookId, kind: "PLAN_FUND", month: current },
		});
		expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
		// Rent: set aside 50,000. Dining: refill to 20,000 with nothing carried in Limits funding of earlier months.
		const byEnvelope = Object.fromEntries(
			rows.map((r) => [r.toEnvelopeId, Number(r.amount) * 100]),
		);
		expect(byEnvelope[b.ids.Rent as string]).toBe(50_000);
		expect(byEnvelope[b.ids.Dining as string]).toBeGreaterThan(0);
		const m = await getMonth(b.user.id);
		const rent = m?.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === b.ids.Rent);
		expect(rent?.target?.need.minor).toBe(0);
	});
});

describe("the budget side of Wealth moves on Postgres", () => {
	it("TO_WEALTH leaves Dining, FROM_WEALTH enters To assign; deleting the kept income deletes its Move in", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const dining = (
			await adminDb.envelope.findFirstOrThrow({
				where: { name: "Dining", book: { createdById: s.user.id } },
			})
		).id;
		const before = await getMonth(s.user.id);
		const kept = await addRow(s.user.id, {
			amount: 250,
			direction: "IN",
			inType: "INCOME",
		});
		await adminDb.expense.update({
			where: { id: kept.id },
			data: { keepInWealth: true },
		});
		const sides = await userTransaction(adminDb, s.user.id, async (tx) => [
			await recordBudgetSide(tx, {
				userId: s.user.id,
				direction: "TO_WEALTH",
				amount: usd(10_000),
				envelopeId: dining,
				date: new Date(),
				transferId: null,
				countOnly: false,
				sourceExpenseId: null,
				assetAccountId: null,
			}),
			await recordBudgetSide(tx, {
				userId: s.user.id,
				direction: "FROM_WEALTH",
				amount: usd(25_000),
				envelopeId: null,
				date: new Date(),
				transferId: null,
				countOnly: true,
				sourceExpenseId: kept.id,
				assetAccountId: null,
			}),
			await recordBudgetSide(tx, {
				userId: s.user.id,
				direction: "FROM_WEALTH",
				amount: { minor: 100, currency: "EUR" },
				envelopeId: null,
				date: new Date(),
				transferId: null,
				countOnly: false,
				sourceExpenseId: null,
				assetAccountId: null,
			}),
		]);
		expect(sides).toEqual([
			{ recorded: true, reason: null },
			{ recorded: true, reason: null },
			{ recorded: false, reason: "other_currency" },
		]);
		const after = await getMonth(s.user.id);
		expect(left(after, dining)).toBe((left(before, dining) ?? 0) - 10_000);
		expect(after?.toAssign.amount.minor).toBe(
			(before?.toAssign.amount.minor ?? 0) + 25_000,
		);

		await userTransaction(adminDb, s.user.id, (tx) =>
			removeBudgetSide(tx, { sourceExpenseId: kept.id }),
		);
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(
			before?.toAssign.amount.minor,
		);
		await userTransaction(adminDb, s.user.id, (tx) =>
			recordBudgetSide(tx, {
				userId: s.user.id,
				direction: "FROM_WEALTH",
				amount: usd(25_000),
				envelopeId: null,
				date: new Date(),
				transferId: null,
				countOnly: true,
				sourceExpenseId: kept.id,
				assetAccountId: null,
			}),
		);
		await adminDb.expense.delete({ where: { id: kept.id } });
		await expect(
			adminDb.wealthTransfer.count({ where: { sourceExpenseId: kept.id } }),
		).resolves.toBe(0);
	});
});

describe("month_close_wealth migration", () => {
	it("applies twice without error (idempotent)", async () => {
		const sql = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261024600000_month_close_wealth/migration.sql",
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
	});
});
