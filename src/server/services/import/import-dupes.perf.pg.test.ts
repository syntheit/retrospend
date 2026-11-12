/**
 * The import duplicate match against a large ledger, with its timing budget.
 * It runs alone, after the other pg files (vitest.pg.config.ts), so other
 * workers cannot skew it. The budget is never loosened. ARS home.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createUserScopedDb } from "~/server/db";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	daysAgo,
	isoDay,
	seedArsRates,
} from "../accounts/test-fixtures";
import { matchFile } from "./match";
import { prepareRows } from "./prepare";
import type { StoredRow } from "./rows";

beforeAll(seedArsRates);

const fileRow = (r: { title: string; amount: number; day: string }) => ({
	title: r.title,
	amount: r.amount,
	currency: "ARS",
	date: r.day,
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
});

async function user() {
	return (await arsUser()).user.id;
}

describe("a large ledger", () => {
	it("matches 5,000 file rows against 20,000 Activity rows within budget", async () => {
		const u = await user();
		// 20 days, 40 amounts: every amount bucket holds hundreds of rows.
		const day = (i: number) => isoDay(daysAgo(5 + (i % 20)));
		await fixtureDb.expense.createMany({
			data: Array.from({ length: 20_000 }, (_, i) => ({
				userId: u,
				title: `Ledger ${i}`,
				amount: 1000 + (i % 40) * 100,
				currency: "ARS",
				date: new Date(`${day(i)}T15:00:00.000Z`),
				exchangeRate: 1468,
				amountInUSD: 1,
				pricingSource: "MANUAL",
			})),
		});
		// Every 10th row is a ledger row typed in (exact); the rest only share amounts.
		const rows = Array.from({ length: 5000 }, (_, i) => ({
			title: i % 10 === 0 ? `Ledger ${i}` : `Bank ${i}`,
			amount: 1000 + (i % 40) * 100,
			day: day(i),
		}));
		const prepared = prepareRows(
			rows.map(fileRow) as unknown as StoredRow[],
			{},
		).rows;

		const started = performance.now();
		const matches = await matchFile(
			createUserScopedDb(u),
			u,
			prepared,
			(r) => r.proposed,
		);
		const ms = performance.now() - started;
		process.stderr.write(`match 5,000 x 20,000: ${Math.round(ms)} ms\n`);
		expect(ms).toBeLessThan(2000);

		const all = [...matches.values()];
		expect(all.filter((m) => m.exact).length).toBe(500);
		// 1:1: no Activity row explains two file rows.
		const ids = all
			.flatMap((m) => [m.exact?.id, m.likely?.id])
			.filter((id): id is string => id != null);
		expect(new Set(ids).size).toBe(ids.length);
	}, 120_000);
});
