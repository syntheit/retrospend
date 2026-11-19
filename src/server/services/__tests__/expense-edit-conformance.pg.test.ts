/**
 * The engine's expense edit and delete conformance cases against the server:
 * every vector (packages/engine/src/expense-edit-vectors.ts, expected values
 * derived by hand there) runs through the entry mutations on a real Postgres,
 * which call the domain core over the Prisma adapter. The device runs the same
 * cases in packages/engine/src/expense-write-local.test.ts. A last test runs
 * each vector on both and asserts the stored rows equal field by field, so the
 * two adapters of the one core cannot drift apart.
 *
 * Rates are global, and a case needs exactly its seed, so each reset replaces
 * the table; the rows other files left in this worker's database are put back
 * after.
 */
import { randomUUID } from "node:crypto";
import { MissingRateError } from "@retrospend/domain/money";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExpense } from "~/server/services/expense-create.mutation";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
	updateExpenseEntry,
} from "~/server/services/entry/expense.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import type { BookedExpense } from "../../../../packages/engine/src/expense-create-conformance";
import {
	type ExpenseEditAdapter,
	expenseEditCases,
} from "../../../../packages/engine/src/expense-edit-conformance";
import { editVectors } from "../../../../packages/engine/src/expense-edit-vectors";
import { localExpenseEditAdapter } from "../../../../packages/engine/src/local-expense-edit";
import { differingFields } from "../../../../packages/engine/src/write-parity";

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

type Row = Prisma.ExpenseGetPayload<{ include: { category: true } }>;

function booked(row: Row, prefix: string): BookedExpense {
	return {
		status: row.status,
		direction: row.direction,
		entryKind: row.entryKind,
		inType: row.inType,
		isAmortizedParent: row.isAmortizedParent,
		excludeFromAnalytics: row.excludeFromAnalytics,
		categoryKind: row.category?.kind ?? null,
		categoryId: row.categoryId?.slice(prefix.length) ?? null,
		date: row.date,
		currency: row.currency,
		amount: row.amount.toString(),
		amountInUSD: row.amountInUSD.toString(),
		exchangeRate: row.exchangeRate.toString(),
		rateType: row.rateType,
		homeCurrency: row.homeCurrency ?? "",
		homeRate: text(row.homeRate) ?? "",
		homeAmount: text(row.homeAmount) ?? "",
		pricingSource: row.pricingSource ?? "",
	};
}

function serverAdapter(): ExpenseEditAdapter {
	let userId = "";
	// Expense ids are global: each reset gets its own prefix.
	let prefix = "";
	const read = async (id: string) => {
		const row = await fixtureDb.expense.findUnique({
			where: { id: prefix + id },
			include: { category: true },
		});
		return row && booked(row, prefix);
	};
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
			await this.setRates(seed.rates);
		},
		async create(input) {
			await forUser(userId).apply(createExpense, {
				...input,
				id: prefix + input.id,
			});
		},
		async setRates(rates) {
			await adminDb.exchangeRate.deleteMany({});
			await adminDb.exchangeRate.createMany({
				data: rates.map((r) => ({
					currency: r.currency,
					type: r.type,
					rate: r.rate,
					date: r.date,
				})),
			});
		},
		async edit(base, fields) {
			const { value } = await forUser(userId).apply(updateExpenseEntry, {
				...base,
				...fields,
				id: prefix + base.id,
			});
			const expense = await read(base.id);
			if (!expense) throw new Error("the edited expense is gone");
			return {
				expense,
				// The edit's undo is another edit with the values it had, signed.
				undo: async () => {
					await forUser(userId).apply(updateExpenseEntry, value.restore);
				},
			};
		},
		async remove(id) {
			const { value } = await forUser(userId).apply(deleteExpenseEntry, {
				id: prefix + id,
			});
			return {
				undo: async () => {
					await forUser(userId).apply(restoreExpenseEntry, {
						token: value.restore,
					});
				},
			};
		},
		read,
	};
}

describe("expense edit conformance (server, real Postgres)", () => {
	for (const c of expenseEditCases(editVectors))
		it(c.name, () => c.run(serverAdapter));
});

/** The same edit on both sides: what each stored, field by field. */
describe("expense edit parity (device and server)", () => {
	for (const v of editVectors) {
		if (!("booked" in v.expect)) continue;
		it(`${v.name}: the device row equals the server row`, async () => {
			const device = localExpenseEditAdapter();
			const server = serverAdapter();
			const rows: BookedExpense[] = [];
			for (const adapter of [device, server]) {
				await adapter.reset(v.seed);
				await adapter.create(v.base);
				if (v.ratesThen) await adapter.setRates(v.ratesThen);
				rows.push((await adapter.edit(v.base, v.edit)).expense);
			}
			const [d, s] = rows as [BookedExpense, BookedExpense];
			expect(differingFields(d, s)).toEqual([]);
			expect(d.excludeFromAnalytics).toBe(s.excludeFromAnalytics);
		});
	}

	it("a refused edit says the same words on both", async () => {
		for (const v of editVectors) {
			if ("booked" in v.expect) continue;
			const errors: unknown[] = [];
			for (const adapter of [localExpenseEditAdapter(), serverAdapter()]) {
				await adapter.reset(v.seed);
				await adapter.create(v.base);
				errors.push(await adapter.edit(v.base, v.edit).catch((e) => e));
			}
			const [d, s] = errors as [Error, Error];
			if ("missingRate" in v.expect) {
				expect(d).toBeInstanceOf(MissingRateError);
				expect(s).toBeInstanceOf(MissingRateError);
				expect((d as MissingRateError).currencies).toEqual(
					(s as MissingRateError).currencies,
				);
			} else expect(d.message).toBe(s.message);
		}
	});
});
