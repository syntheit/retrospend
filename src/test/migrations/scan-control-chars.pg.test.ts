// scripts/scan-control-chars.ts counts, per user-text column, the rows that
// hold text the app now refuses. It must see every column, count what it says
// it counts, and print no value and no user id.
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	type ColumnCount,
	formatScan,
	scanControlChars,
} from "../../../scripts/scan-control-chars";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

const at = (counts: ColumnCount[], table: string, column: string) => {
	const found = counts.find((c) => c.table === table && c.column === column);
	if (!found) throw new Error(`${table}.${column} is not scanned`);
	return found;
};

describe("scan-control-chars", () => {
	it("finds every column in the migrated database", async () => {
		const counts = await scanControlChars(pool);
		expect(counts.filter((c) => c.rows === null)).toEqual([]);
	});

	it("counts controls and the U+0001 marker, and keeps tab, line feed and carriage return", async () => {
		const before = await scanControlChars(pool);
		const { user } = await createTestUser();
		const base = {
			userId: user.id,
			currency: "ARS",
			exchangeRate: 1468,
			pricingSource: "MANUAL",
			amount: 100,
			amountInUSD: 0.07,
			date: new Date("2026-11-01T12:00:00Z"),
		};
		await adminDb.expense.createMany({
			data: [
				{ ...base, title: "clean\nlines\r\n\ttabbed", description: "ok" },
				{ ...base, title: "bad\u000bvertical tab", location: "BA\u0007" },
				{ ...base, title: "\u0001k1:AAAA", description: "x\u001fy" },
				{ ...base, title: "replaced �" },
			],
		});

		const after = await scanControlChars(pool);
		const delta = (table: string, column: string) => {
			const a = at(after, table, column);
			const b = at(before, table, column);
			return {
				rows: (a.rows ?? 0) - (b.rows ?? 0),
				controls: a.controls - b.controls,
				marker: a.startsWithU0001 - b.startsWithU0001,
				replacement: a.replacement - b.replacement,
			};
		};
		expect(delta("expense", "title")).toEqual({
			rows: 4,
			controls: 2,
			marker: 1,
			replacement: 1,
		});
		expect(delta("expense", "location").controls).toBe(1);
		expect(delta("expense", "description").controls).toBe(1);
		expect(delta("category", "name").controls).toBe(0);
	});

	it("prints counts only", async () => {
		const { user } = await createTestUser();
		await adminDb.expense.create({
			data: {
				userId: user.id,
				title: "secret\u000btitle",
				currency: "ARS",
				exchangeRate: 1468,
				pricingSource: "MANUAL",
				amount: 5,
				amountInUSD: 0.01,
				date: new Date("2026-11-01T12:00:00Z"),
			},
		});
		const out = formatScan(await scanControlChars(pool));
		expect(out).toContain("expense.title");
		expect(out).not.toContain("secret");
		expect(out).not.toContain(user.id);
		expect(out).not.toContain(user.email);
	});
});
