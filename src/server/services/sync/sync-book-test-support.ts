/**
 * Fixtures for the personal-book sync tests (E2EE lane P, P14c): one personal
 * book with a row in each of the twelve tables of its family, linked the way
 * the app links them, and the stamps of the family read as the owner.
 */
import { randomUUID } from "node:crypto";
import { fixtureDb, fixtureNameIndex } from "~/test/pg-harness";
import { SYNCED_BOOK_ENTITIES } from "./book-entities";
import { describeStamps, stampsOf } from "./sync-test-support";

export type SeededBook = Awaited<ReturnType<typeof seedBook>>;

const MONTH_START = new Date("2026-11-01T00:00:00.000Z");

/**
 * The owner's personal book: a group, two envelopes (Rent holds a movement,
 * a rule, a payoff plan and a Wealth transfer; Spare holds only a category
 * link, so it can be deleted), a period, a close, a rule run (keyed by an
 * income row's id) and an edit record. The creator is also the book's OWNER
 * member, as book.service writes it.
 */
export async function seedBook(userId: string) {
	const tag = userId.slice(0, 8);
	const book = await fixtureDb.budgetBook.create({
		data: {
			createdById: userId,
			name: `Home ${tag}`,
			currency: "ARS",
			startDate: MONTH_START,
			startMonth: 202611,
		},
	});
	await fixtureDb.budgetMember.create({
		data: { bookId: book.id, userId, role: "OWNER" },
	});
	const group = await fixtureDb.envelopeGroup.create({
		data: { bookId: book.id, name: "Needs", sortOrder: 1, role: "BILLS" },
	});
	const rent = await fixtureDb.envelope.create({
		data: {
			bookId: book.id,
			groupId: group.id,
			name: "Rent",
			sortOrder: 1,
			kind: "BILL",
			targetAmount: "150000.5",
		},
	});
	const spare = await fixtureDb.envelope.create({
		data: { bookId: book.id, name: "Spare", sortOrder: 2 },
	});
	const categoryName = `Home ${tag}`;
	const category = await fixtureDb.category.create({
		data: {
			userId,
			name: categoryName,
			color: "emerald",
			nameIndex: await fixtureNameIndex(userId, categoryName),
		},
	});
	const spareLink = await fixtureDb.envelopeCategory.create({
		data: { bookId: book.id, envelopeId: spare.id, categoryId: category.id },
	});
	const movement = await fixtureDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			month: 202611,
			toEnvelopeId: rent.id,
			amount: "75000.25",
			kind: "ASSIGN",
			actorUserId: userId,
			note: "Top up",
		},
	});
	const period = await fixtureDb.bookPeriod.create({
		data: { bookId: book.id, fromMonth: 202611, startDay: 1, rateType: "blue" },
	});
	const close = await fixtureDb.monthClose.create({
		data: {
			bookId: book.id,
			month: 202610,
			summary: { closed: true },
			checkpoint: { internal: "cache" },
		},
	});
	const rule = await fixtureDb.incomeRule.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			sortOrder: 0,
			name: "Salary split",
			action: "PERCENT",
			value: "20",
			envelopeId: rent.id,
		},
	});
	const incomeRowId = randomUUID();
	await fixtureDb.incomeRuleRun.create({
		data: {
			expenseId: incomeRowId,
			bookId: book.id,
			record: { ran: true },
			fingerprint: "fp-1",
		},
	});
	const plan = await fixtureDb.payoffPlan.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			extraMonthly: "1000",
			customOrder: ["acc-1"],
			undo: { internal: "state" },
		},
	});
	const wealthTransfer = await fixtureDb.wealthTransfer.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			direction: "TO_WEALTH",
			envelopeId: rent.id,
			countOnly: true,
			date: new Date("2026-11-05T00:00:00.000Z"),
			amount: "300.5",
			actorUserId: userId,
			note: "To the fund",
		},
	});
	const change = await fixtureDb.envelopeChange.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			kind: "UPDATE",
			envelopeId: rent.id,
			previousName: "Old rent",
			before: { targetAmount: "100" },
			actorUserId: userId,
		},
	});
	return {
		book: book.id,
		group: group.id,
		rent: rent.id,
		spare: spare.id,
		category: category.id,
		spareLink: spareLink.id,
		movement: movement.id,
		period: period.id,
		close: close.id,
		rule: rule.id,
		run: incomeRowId,
		plan: plan.id,
		wealthTransfer: wealthTransfer.id,
		change: change.id,
	};
}

/** The stamps of the twelve family tables for one user, as `entity:id:op`, sorted. */
export async function bookStamps(userId: string): Promise<string[]> {
	const rows = await stampsOf(userId);
	const family = new Set<string>(SYNCED_BOOK_ENTITIES);
	return describeStamps(rows.filter((r) => family.has(r.entity)));
}

/** What a freshly seeded book stamps: one U per row of the twelve tables. */
export function seededStamps(s: SeededBook, op: "U" | "D" = "U"): string[] {
	return [
		`budget_book:${s.book}:${op}`,
		`envelope_group:${s.group}:${op}`,
		`envelope:${s.rent}:${op}`,
		`envelope:${s.spare}:${op}`,
		`envelope_category:${s.spareLink}:${op}`,
		`budget_movement:${s.movement}:${op}`,
		`book_period:${s.period}:${op}`,
		`month_close:${s.close}:${op}`,
		`income_rule:${s.rule}:${op}`,
		`income_rule_run:${s.run}:${op}`,
		`payoff_plan:${s.plan}:${op}`,
		`wealth_transfer:${s.wealthTransfer}:${op}`,
		`envelope_change:${s.change}:${op}`,
	].sort();
}
