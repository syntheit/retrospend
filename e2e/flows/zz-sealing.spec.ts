import { Pool } from "pg";
import { SEALING_FLOOR } from "~/server/crypto/release";
import {
	E2E_DATABASE_URL,
	E2E_SEALED,
	TEST_USER,
	USER_STORAGE_STATE,
} from "../constants";
import { SEED_USERS } from "../fixtures/personas";
import { expect, guardStats, test } from "../fixtures/sealed-guard";
import { untilSaved } from "../helpers/trpc";
import { trpcQuery } from "./entry-audit";
import { openV2 } from "./viewer";

// Sealed runs only (E2E_SEALED=1, E2EE D11 PR 9.2): the server this run
// started has the flag on, so what it wrote must be ciphertext in the
// database and plaintext in every response. It reads the database as the
// owner. The sweep for plaintext left anywhere else runs from global teardown
// (global-teardown.ts), so every CI shard has it, not only the one that holds
// this file.

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
	const seenBefore = guardStats.pageTrpc;
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

	// The guard (fixtures/sealed-guard.ts) read the page's own tRPC answers
	// while this test ran: one that sees nothing must not pass as clean.
	await expect
		.poll(() => guardStats.pageTrpc, "page tRPC responses inspected")
		.toBeGreaterThan(seenBefore);
});
