/** Shared seed for the envelope pg tests: a USD user with Rent and Dining, a Flex setup, plain rows. */
import type { SetupInput } from "~/lib/schemas/envelope";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

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
