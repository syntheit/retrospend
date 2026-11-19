/**
 * The engine's expense create conformance cases against the server: every
 * vector (packages/engine/src/expense-create-vectors.ts, expected values
 * derived by hand there) runs through createExpenseIn on a real Postgres via
 * the expense.create money mutation, so the web, the engine and the mobile
 * app book the same row. The device runs the same cases in
 * packages/engine/src/expense-create.test.ts.
 *
 * Rates are global, and a case needs exactly its seed (a vector checks the
 * nearest later row and a missing rate), so each reset replaces the table;
 * the rows other files left in this worker's database are put back after.
 */
import { randomUUID } from "node:crypto";
import { AMOUNT_ABOVE_ZERO } from "@retrospend/domain/expense-write/refusals";
import { dec } from "@retrospend/domain/precise-decimal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import {
	type BookedExpense,
	type ExpenseCreateAdapter,
	expenseCreateCases,
} from "../../../../packages/engine/src/expense-create-conformance";
import { vectors } from "../../../../packages/engine/src/expense-create-vectors";

let others: Prisma.ExchangeRateCreateManyInput[] = [];

beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

const text = (value: { toString(): string } | null) =>
	value === null ? null : value.toString();

function serverAdapter(): ExpenseCreateAdapter {
	let userId = "";
	// Expense ids are global: each reset gets its own prefix, stripped on the way out.
	let prefix = "";
	return {
		async reset(seed) {
			const { user } = await createTestUser();
			userId = user.id;
			prefix = `${randomUUID()}-`;
			await adminDb.user.update({
				where: { id: userId },
				data: {
					homeCurrency: seed.homeCurrency,
					timeZone: seed.timeZone,
					defaultRateTypes: seed.defaultRateTypes ?? {},
				},
			});
			await adminDb.exchangeRate.deleteMany({});
			await adminDb.exchangeRate.createMany({
				data: seed.rates.map((r) => ({
					currency: r.currency,
					type: r.type,
					rate: r.rate,
					date: r.date,
				})),
			});
		},
		async create({ category, ...input }) {
			// The device is handed a resolved category; the server needs the row.
			if (category)
				await fixtureDb.category.upsert({
					where: { id: prefix + category.id },
					update: {},
					create: {
						id: prefix + category.id,
						userId,
						name: `Cat ${category.id}`,
						color: "teal",
						kind: category.kind as "EXPENSE" | "INCOME",
						excludeByDefault: category.excludeByDefault,
					},
				});
			const { value, undo } = await forUser(userId).apply(createExpense, {
				...input,
				id: prefix + input.id,
				categoryId: category && prefix + category.id,
			});
			const expense: BookedExpense = {
				status: value.status,
				direction: value.direction,
				entryKind: value.entryKind,
				inType: value.inType,
				isAmortizedParent: value.isAmortizedParent,
				excludeFromAnalytics: value.excludeFromAnalytics,
				categoryKind: value.category?.kind ?? null,
				categoryId: value.categoryId?.slice(prefix.length) ?? null,
				date: value.date,
				currency: value.currency,
				amount: value.amount.toString(),
				amountInUSD: value.amountInUSD.toString(),
				exchangeRate: value.exchangeRate.toString(),
				rateType: value.rateType,
				homeCurrency: value.homeCurrency ?? "",
				homeRate: text(value.homeRate) ?? "",
				homeAmount: text(value.homeAmount) ?? "",
				pricingSource: value.pricingSource ?? "",
			};
			return {
				expense,
				// The token reverts the rows it names: a create's row is deleted.
				undo: async () => {
					if (undo.kind !== "revert") throw new Error("expected a revert");
					for (const row of undo.rows)
						await fixtureDb.expense.delete({ where: { id: row.id } });
				},
			};
		},
		async expenseIds() {
			const rows = await fixtureDb.expense.findMany({
				where: { userId },
				select: { id: true },
			});
			return rows.map((r) => r.id.slice(prefix.length));
		},
	};
}

/**
 * What the schema refuses that cannot be seeded: a rate of 0 or less
 * (exchange_rate_rate_positive). An expense amount of 0 or less is the
 * domain's refusal now (expense-write/create.ts), so those vectors run below
 * like the rest, with the device's words.
 */
const unseedable = new Set(
	vectors
		.filter((v) => v.seed.rates.some((r) => !dec(r.rate).gt(0)))
		.map((v) => v.name),
);
const refused = vectors.filter(
	(v) => !dec(v.input.amount).gt(0) && !unseedable.has(v.name),
);

describe("expense create conformance (server, real Postgres)", () => {
	for (const c of expenseCreateCases) {
		if (unseedable.has(c.name)) continue;
		it(c.name, () => c.run(serverAdapter));
	}

	it("refuses every amount of 0 or less with the domain's message, not the check constraint's", async () => {
		expect(refused.length).toBeGreaterThan(0);
		for (const v of refused) {
			const adapter = serverAdapter();
			await adapter.reset(v.seed);
			await expect(adapter.create(v.input)).rejects.toThrow(AMOUNT_ABOVE_ZERO);
			expect(await adapter.expenseIds()).toEqual([]);
		}
	});
});
