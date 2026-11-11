// scripts/scan-control-chars.ts counts, per user-text column, the rows that
// hold text the app now refuses. It must see every column, count what it says
// it counts, and print no value and no user id.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser, withSuperuser } from "~/test/pg-harness";
import {
	type ColumnCount,
	formatScan,
	hasBlockingRows,
	runScan,
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
				{ ...base, title: "marker", description: "x\u001fy" },
				{ ...base, title: "replaced �" },
			],
		});
		// Raw SQL: the clients refuse a value that starts like ciphertext.
		await adminDb.$executeRaw`
			UPDATE "expense" SET "title" = ${"\u0001k1:AAAA"}
			WHERE "userId" = ${user.id} AND "title" = 'marker'`;

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

// The worker database is shared by every file, so other files' rows would
// decide the exit code. The gate runs against a schema of its own that holds
// one mapped table, which the scan finds through the pool's search path.
describe("scan-control-chars --fail", () => {
	const schema = "scan_fail_gate";
	let gatePool: Pool;

	const setRows = async (...titles: string[]) => {
		await gatePool.query("DELETE FROM expense");
		for (const title of titles)
			await gatePool.query("INSERT INTO expense (title) VALUES ($1)", [title]);
	};
	const run = async (fail: boolean) => {
		const lines: string[] = [];
		const code = await runScan(gatePool, { fail }, (t) => lines.push(t));
		return { code, out: lines.join("\n") };
	};

	beforeAll(async () => {
		await withSuperuser(async (client) => {
			await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			await client.query(`CREATE SCHEMA ${schema}`);
			await client.query(`CREATE TABLE ${schema}.expense (title text)`);
		});
		gatePool = new Pool({
			connectionString: process.env.PG_TEST_SUPER_URL,
			options: `-c search_path=${schema}`,
		});
	});
	afterAll(async () => {
		await gatePool.end();
		await withSuperuser((client) =>
			client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`),
		);
	});

	it("passes on clean text, including tab, line feed, carriage return and U+FFFD", async () => {
		await setRows(
			"plain",
			"a\tb\nc\r\nd",
			"replaced \ufffd",
			"\u00e9\u{1f600}",
		);
		expect((await run(true)).code).toBe(0);
	});

	it("fails on a value that starts with U+0001", async () => {
		await setRows("plain", "\u0001k1:AAAA");
		const { code, out } = await run(true);
		expect(code).toBe(1);
		expect(out).toContain("Blocked");
	});

	it("fails on a C0 control anywhere in a value", async () => {
		await setRows("plain", "mid\u0007dle");
		expect((await run(true)).code).toBe(1);
	});

	it("without --fail it reports the same rows and exits 0", async () => {
		await setRows("\u0001k1:AAAA", "mid\u0007dle");
		const { code, out } = await run(false);
		expect(code).toBe(0);
		expect(out).toContain("Rows starting with U+0001: 1");
		expect(out).not.toContain("Blocked");
	});

	it("never prints a value", async () => {
		await setRows("secret\u0007text");
		expect((await run(true)).out).not.toContain("secret");
	});

	it("decides from the counts: a missing table does not block", () => {
		const none: ColumnCount = {
			table: "t",
			column: "c",
			rows: null,
			controls: 0,
			startsWithU0001: 0,
			replacement: 3,
		};
		expect(hasBlockingRows([none])).toBe(false);
		expect(hasBlockingRows([{ ...none, rows: 2, startsWithU0001: 1 }])).toBe(
			true,
		);
	});
});
