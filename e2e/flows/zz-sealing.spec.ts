import { Pool } from "pg";
import { jsonColumns, mappedColumns } from "~/server/crypto/fields";
import {
	plainBodySql,
	plainTextSql,
	textLeaves,
} from "~/server/crypto/plaintext-sql";
import { SEALING_FLOOR } from "~/server/crypto/release";
import {
	E2E_DATABASE_URL,
	E2E_SEALED,
	TEST_USER,
	USER_STORAGE_STATE,
} from "../constants";
import { SEED_USERS } from "../fixtures/personas";
import { expect, test } from "../fixtures/sealed-guard";
import { untilSaved } from "../helpers/trpc";
import { readSeedIds } from "../sealing-seed";
import { trpcQuery } from "./entry-audit";
import { openV2 } from "./viewer";

// Sealed runs only (E2E_SEALED=1, E2EE D11 PR 9.2): the server this run
// started has the flag on, so what it wrote must be ciphertext in the
// database and plaintext in every response. "zz" keeps it last, so the sweep
// at the end sees what the whole suite wrote. It reads the database as the
// owner, like scripts/verify-sealing.ts, and shares that script's plaintext
// rules (src/server/crypto/plaintext-sql.ts).

test.skip(!E2E_SEALED, "sealed runs only (E2E_SEALED=1)");
test.use({ storageState: USER_STORAGE_STATE });

const SEALED_PREFIX = "\u0001k1:";
const SETTINGS = "app_settings_singleton";

let pool: Pool;
test.beforeAll(() => {
	pool = new Pool({ connectionString: E2E_DATABASE_URL });
});
test.afterAll(async () => {
	await pool.end();
});

async function one<T extends Record<string, unknown>>(
	sql: string,
	params: unknown[] = [],
): Promise<T> {
	const { rows } = await pool.query<T>(sql, params);
	expect(rows, "one row expected").toHaveLength(1);
	return rows[0] as T;
}

const sealedUser = (email: string) =>
	one<{ id: string; sealed: boolean; plain: boolean }>(
		`SELECT "id", starts_with("name", E'\\x01k1:') AS sealed,
			NOT starts_with("name", E'\\x01k1:') AS plain
		 FROM "user" WHERE "email" = $1`,
		[email],
	);

test("the server started sealing: epoch, floor, canary and instance key", async () => {
	const row = await one<{
		epoch: boolean;
		floor: number | null;
		canary: boolean;
		marker: boolean;
		keys: string;
	}>(
		`SELECT "fieldEncryptionSince" IS NOT NULL AS epoch,
			"sealingFloor" AS floor,
			"masterKeyCanary" IS NOT NULL AS canary,
			"instanceKeySince" IS NOT NULL AS marker,
			(SELECT count(*) FROM keystore."instance_text_key") AS keys
		 FROM "app_settings" WHERE "id" = $1`,
		[SETTINGS],
	);
	expect(row).toMatchObject({ epoch: true, canary: true, marker: true });
	expect(row.floor).toBe(SEALING_FLOOR);
	expect(Number(row.keys)).toBe(1);
});

test("accounts signed up through the server have a sealed name and sealed, indexed default categories", async () => {
	for (const email of [TEST_USER.email, "e2e-admin@retrospend.app"]) {
		const user = await sealedUser(email);
		expect(user.sealed, `${email}: user.name is sealed`).toBe(true);
		const cats = await one<{ total: string; sealed: string; indexed: string }>(
			`SELECT count(*) AS total,
				count(*) FILTER (WHERE starts_with("name", E'\\x01k1:')) AS sealed,
				count(*) FILTER (WHERE "nameIndex" IS NOT NULL) AS indexed
			 FROM "category" WHERE "userId" = $1`,
			[user.id],
		);
		expect(
			Number(cats.total),
			`${email}: has default categories`,
		).toBeGreaterThan(0);
		expect(cats.sealed, `${email}: sealed category names`).toBe(cats.total);
		expect(cats.indexed, `${email}: category name indexes`).toBe(cats.total);
	}
});

test("seeded categories were indexed the way the runbook does, names left as legacy plaintext", async () => {
	const row = await one<{ missing: string; legacy: string }>(
		`SELECT count(*) FILTER (WHERE "nameIndex" IS NULL) AS missing,
			count(*) FILTER (WHERE NOT starts_with("name", E'\\x01k1:')) AS legacy
		 FROM "category" WHERE "userId" = ANY($1::text[])`,
		[SEED_USERS.map((u) => u.id)],
	);
	expect(row.missing).toBe("0");
	expect(Number(row.legacy)).toBeGreaterThan(0);
});

test("an expense made in the UI is sealed in the database and plaintext in the API", async ({
	page,
}) => {
	const title = `sealing probe ${Date.now()}`;
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await sheet.getByRole("textbox", { name: "Amount" }).fill("12");
	await sheet.getByRole("textbox", { name: "Title" }).fill(title);
	await sheet
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: "All categories" })
		.click();
	await page.getByRole("option", { name: "Subscriptions" }).click();
	await untilSaved(page, "entry.expense.create.save", () =>
		sheet.getByRole("button", { name: "Add expense" }).click(),
	);
	await expect(sheet).toBeHidden();

	const { id } = await sealedUser(TEST_USER.email);
	const row = await one<{ id: string; title: string }>(
		`SELECT "id", "title" FROM "expense" WHERE "userId" = $1
		 ORDER BY "createdAt" DESC LIMIT 1`,
		[id],
	);
	expect(row.title.startsWith(SEALED_PREFIX)).toBe(true);
	expect(row.title).not.toContain(title);

	const served = await trpcQuery<{ title: string }>(
		page,
		"expense.getExpense",
		{
			id: row.id,
		},
	);
	expect(served.title).toBe(title);
});

/**
 * Rows the seed wrote are legacy plaintext (the snapshot). So are rows a spec
 * inserts with SQL as the owner (budget-sheets.spec.ts): their ids start
 * `e2e` or `ce2e`, and the server never makes an id like that.
 */
const notSeeded = (ids: Record<string, string[]>, table: string) => ({
	params: ids[table] ?? [],
	where: `"id"::text !~ '^c?e2e' AND "id"::text <> ALL($1::text[])`,
});

test("every mapped column holds no plaintext in rows the seed did not write", async () => {
	const ids = readSeedIds();
	const found: string[] = [];
	const count = async (table: string, column: string, plain: string) => {
		const { params, where } = notSeeded(ids, table);
		const { rows } = await pool.query<{ n: string }>(
			`SELECT count(*) AS n FROM "${table}" WHERE (${plain}) AND ${where}`,
			[params],
		);
		if (Number(rows[0]?.n) > 0) found.push(`${table}.${column}: ${rows[0]?.n}`);
	};
	// A payment confirm's `previous` copies its source cells as they are, so a
	// legacy plaintext source stays plaintext there until the D12 reseal: the
	// shared classification calls those leaves legacy copies (plaintext-sql.ts).
	for (const [table, column] of mappedColumns())
		await count(table, column, plainTextSql(table, column));
	for (const [table, column, cell] of jsonColumns()) {
		if (cell.mode === "body") {
			await count(table, column, plainBodySql(column));
			continue;
		}
		const { params, where } = notSeeded(ids, table);
		const { rows } = await pool.query<{ v: unknown }>(
			`SELECT "${column}" AS v FROM "${table}"
			 WHERE "${column}" IS NOT NULL AND jsonb_typeof("${column}") = 'object'
			   AND ${where}`,
			[params],
		);
		const bad = new Set<string>();
		for (const { v } of rows)
			for (const { path, state } of textLeaves(v, cell))
				if (state !== "sealed" && state !== "legacy_copy")
					bad.add(path.join("."));
		if (bad.size > 0)
			found.push(`${table}.${column}: leaves at ${[...bad].join(", ")}`);
	}
	// Names and paths, never a value.
	expect(found, "plaintext in rows made after the seed").toEqual([]);
});
