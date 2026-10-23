/** Shared seed for the envelope pg tests: a USD user with Rent and Dining, a Flex setup, plain rows. */
import { randomUUID } from "node:crypto";
import type { SetupInput } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { computeBook } from "../engine";
import { loadBook } from "../inputs";
import { invariantSides } from "../invariant";
import { setupEnvelopeBook } from "../setup.mutation";

/**
 * Both sides of the SPEC §5.3 invariant for a user's book at `now`, from a
 * full pass (no checkpoint): the ledger side needs every row.
 */
export function invariantAt(userId: string, now = new Date()) {
	return userTransaction(adminDb, userId, async (tx) => {
		const loaded = await loadBook(tx, userId, { now, needFrom: 0 });
		if (!loaded) throw new Error("no book");
		return invariantSides(loaded.input, computeBook(loaded.input));
	});
}

export async function seedUser() {
	const { user, db } = await createTestUser();
	const cat = (name: string) =>
		adminDb.category
			.create({ data: { name, color: "blue", userId: user.id } })
			.then((c) => c.id);
	return { user, db, rent: await cat("Rent"), dining: await cat("Dining") };
}

export function setupInput(c: { rent: string; dining: string }): SetupInput {
	return {
		style: "FLEX",
		startingMoneyMinor: 100_000,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
		],
		envelopes: [
			{
				key: "rent",
				name: "Rent",
				groupKey: "bills",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [c.rent],
				target: {
					kind: "MONTHLY",
					amountMinor: 50_000,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
			{
				key: "dining",
				name: "Dining",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [c.dining],
				target: {
					kind: "MONTHLY",
					amountMinor: 20_000,
					mode: "REFILL",
					cadence: "MONTH",
				},
			},
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

type Row = {
	amount: number;
	categoryId?: string | null;
	direction?: "IN" | "OUT";
	entryKind?: "STANDARD" | "NOT_SPENDING";
	inType?: "INCOME" | "REFUND";
	excludeFromAnalytics?: boolean;
};

export function addRow(userId: string, r: Row, date = new Date()) {
	return adminDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: new Prisma.Decimal(r.amount),
			currency: "USD",
			date,
			categoryId: r.categoryId ?? null,
			amountInUSD: new Prisma.Decimal(r.amount),
			exchangeRate: new Prisma.Decimal(1),
			pricingSource: "MANUAL",
			direction: r.direction ?? "OUT",
			entryKind: r.entryKind ?? "STANDARD",
			inType: r.inType ?? null,
			excludeFromAnalytics: r.excludeFromAnalytics ?? false,
		},
	});
}
export const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

export async function augustBook() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	await adminDb.budgetBook.update({
		where: { id: book.id },
		data: { startMonth: 202608, startDate: new Date("2026-08-01T00:00:00Z") },
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { fromMonth: 202608 },
	});
	await adminDb.expense.update({
		where: { id: book.startingBalanceExpenseId as string },
		data: { date: new Date("2026-08-01T00:00:00Z") },
	});
	const ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	await adminDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			month: 202608,
			toEnvelopeId: ids.Dining,
			amount: 300,
			kind: "ASSIGN",
			actorUserId: s.user.id,
		},
	});
	const aug = await addRow(
		s.user.id,
		{ amount: 100, categoryId: s.dining },
		at("2026-08-12"),
	);
	await addRow(
		s.user.id,
		{ amount: 50, categoryId: s.dining },
		at("2026-09-12"),
	);
	return { ...s, bookId: book.id, diningEnv: ids.Dining as string, aug };
}
