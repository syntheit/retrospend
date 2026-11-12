import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { runtimeDataModel } from "~/server/db-core";
import { PrismaClient } from "~prisma";
import { guardMoneyWrites, numberWrites } from "./write-guard";

const data = runtimeDataModel();
const writes = (model: string, args: unknown) =>
	numberWrites(data, model, args);

describe("numberWrites", () => {
	it("names each Decimal column given a JS number", () => {
		expect(
			writes("Expense", {
				data: {
					amount: 12.5,
					amountInUSD: "0.28",
					exchangeRate: 100,
					title: "x",
				},
			}),
		).toEqual(["Expense.amount", "Expense.exchangeRate"]);
	});

	it("reads operations on a column and every write shape", () => {
		expect(
			writes("Expense", {
				where: { id: "e" },
				data: { amount: { increment: 1 } },
			}),
		).toEqual(["Expense.amount"]);
		expect(
			writes("Expense", { data: [{ amountInUSD: 1 }, { amount: "2" }] }),
		).toEqual(["Expense.amountInUSD"]);
		expect(
			writes("Expense", {
				where: { id: "e" },
				create: { amount: "1" },
				update: { exchangeRate: { set: 2 } },
			}),
		).toEqual(["Expense.exchangeRate"]);
	});

	it("follows nested relation writes into their model", () => {
		expect(
			writes("SharedTransaction", {
				data: {
					amount: "10",
					splitParticipants: {
						create: [{ shareAmount: 3.33 }, { shareAmount: "3.33" }],
						updateMany: {
							where: { shareAmount: 1 },
							data: { sharePercentage: 50 },
						},
					},
				},
			}),
		).toEqual([
			"SplitParticipant.shareAmount",
			"SplitParticipant.sharePercentage",
		]);
	});

	it("passes strings, Decimals, null, filters and non-Decimal numbers", () => {
		expect(
			writes("Expense", {
				where: { amount: 5 },
				data: {
					amount: "12.50",
					amountInUSD: null,
					exchangeRate: { toString: () => "1" },
				},
			}),
		).toEqual([]);
		expect(writes("User", { data: { fiscalMonthStartDay: 5 } })).toEqual([]);
	});
});

describe("guardMoneyWrites on a client", () => {
	// Nothing listens here: a refused write never reaches the connection.
	const raw = new PrismaClient({
		adapter: new PrismaPg({
			connectionString: "postgresql://x:x@127.0.0.1:1/none",
		}),
	});

	it("refuses a number before the query runs, and lets a listed writer through", async () => {
		// Count this file as app code, so its writes are checked.
		const guarded = guardMoneyWrites(
			raw,
			{
				"Expense.exchangeRate": ["src/test/money/write-guard.test.ts"],
				"Expense.amount": ["src/server/services/expense.service.ts"],
			},
			() => false,
		);
		await expect(
			guarded.expense.update({
				where: { id: "e" },
				data: { amountInUSD: 0.28 },
			}),
		).rejects.toThrow(
			/JS number was written to Expense\.amountInUSD at src\/test\/money\/write-guard\.test\.ts:\d+/,
		);
		// Listed for another file only: refused here.
		await expect(
			guarded.expense.update({ where: { id: "e" }, data: { amount: 1 } }),
		).rejects.toThrow(/JS number was written to Expense\.amount at/);
		// A listed column goes on to the query, which fails only for want of a database.
		const failed = await guarded.expense
			.update({ where: { id: "e" }, data: { exchangeRate: 100 } })
			.then(
				() => null,
				(error: unknown) => error,
			);
		// Prisma's own error (no server), not the guard's plain Error.
		expect((failed as Error).name).toMatch(/^PrismaClient/);
	});

	it("lets test code write literal numbers", async () => {
		const failed = await guardMoneyWrites(raw)
			.expense.update({ where: { id: "e" }, data: { amountInUSD: 0.28 } })
			.then(
				() => null,
				(error: unknown) => error,
			);
		expect((failed as Error).name).toMatch(/^PrismaClient/);
	});

	it("keeps the runtime data model db-core reads off the client it is given", () => {
		const guarded = guardMoneyWrites(raw) as unknown as {
			_runtimeDataModel?: unknown;
		};
		expect(guarded._runtimeDataModel).toBe(
			(raw as unknown as { _runtimeDataModel: unknown })._runtimeDataModel,
		);
	});
});
