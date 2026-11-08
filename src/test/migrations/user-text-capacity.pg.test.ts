// Field encryption (docs/roadmap/e2ee-spike.md 4.5, lane D) stores a longer
// string than the plaintext. Every column that holds a declared user-text
// field must fit the ciphertext of the longest value its limit allows, or the
// D11 backfill fails on a long title. This reads the real column types from
// the migrated database, so a new field, a new limit or a new bounded column
// that breaks the rule fails here.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { USER_TEXT_FIELDS } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { Keyring, sealField } from "~/server/crypto/field-crypto";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { REPO_ROOT } from "../uiRules/paths";

// The contract and form schemas are loaded so the registry can cross-check
// the source scan below (it need not be complete).
import.meta.glob(
	[
		"../../../packages/api-contract/src/**/*.ts",
		"../../lib/schemas/*.ts",
		"!**/*.test.ts",
	],
	{ eager: true },
);

/**
 * Every `userText("field", max)` or `userTextOrEmpty("field", max)` call in
 * the source tree, found by reading the files, so a declaration in a router or
 * a service counts without importing it. A field declared with several
 * limits keeps the largest. A call the scan cannot read (a variable name or
 * limit) is reported, never skipped. A bare `userText()` in prose is not a
 * call.
 */
function scanDeclarations(): {
	limits: Map<string, number>;
	unreadable: string[];
} {
	const limits = new Map<string, number>();
	const unreadable: string[] = [];
	const skip = new Set(["node_modules", "generated", "dist", ".next"]);
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!skip.has(entry.name)) walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
				continue;
			if (path.endsWith(join("common", "user-text.ts"))) continue;
			const text = readFileSync(path, "utf8");
			const calls = text.match(/\buserText(?:OrEmpty)?\((?!\))/g)?.length ?? 0;
			if (calls === 0) continue;
			let read = 0;
			for (const m of text.matchAll(
				/\buserText(?:OrEmpty)?\(\s*"([^"]+)"\s*,\s*(\d+)\s*\)/g,
			)) {
				read++;
				const [, field = "", max = "0"] = m;
				limits.set(field, Math.max(limits.get(field) ?? 0, Number(max)));
			}
			if (read !== calls) unreadable.push(path);
		}
	};
	for (const root of ["src", "packages"]) walk(join(REPO_ROOT, root));
	return { limits, unreadable };
}

const scanned = scanDeclarations();

type Column = { table: string; column: string };

/** Declared field to the database columns it is stored in. */
const STORED: Record<string, Column[]> = {
	"account.name": [{ table: "asset_account", column: "name" }],
	"apikey.name": [{ table: "apikey", column: "name" }],
	"billing_period.label": [{ table: "billing_period", column: "label" }],
	"budgetGroup.name": [{ table: "envelope_group", column: "name" }],
	"category.name": [{ table: "category", column: "name" }],
	"envelope.name": [{ table: "envelope", column: "name" }],
	"expense.description": [{ table: "expense", column: "description" }],
	"expense.location": [{ table: "expense", column: "location" }],
	"expense.title": [{ table: "expense", column: "title" }],
	"feedback.adminNote": [{ table: "feedback", column: "adminNote" }],
	"feedback.message": [{ table: "feedback", column: "message" }],
	"fixRequest.message": [{ table: "fix_request", column: "message" }],
	"fixRequest.reply": [{ table: "fix_request", column: "reply" }],
	"guest_session.name": [{ table: "guest_session", column: "name" }],
	"income.description": [{ table: "expense", column: "description" }],
	"income.title": [{ table: "expense", column: "title" }],
	"incomeRule.matchTitle": [{ table: "income_rule", column: "matchTitle" }],
	"incomeRule.name": [{ table: "income_rule", column: "name" }],
	"payment.method": [
		{ table: "payment", column: "paymentMethod" },
		{ table: "settlement", column: "paymentMethod" },
	],
	"payment.note": [
		{ table: "payment", column: "note" },
		{ table: "settlement", column: "note" },
	],
	"payment.reject_reason": [{ table: "settlement", column: "rejectedReason" }],
	"payment_method.identifier": [
		{ table: "payment_method", column: "identifier" },
	],
	"payment_method.label": [{ table: "payment_method", column: "label" }],
	"person.name": [{ table: "shadow_profile", column: "name" }],
	"project.description": [{ table: "project", column: "description" }],
	"project.name": [{ table: "project", column: "name" }],
	"recurring.name": [{ table: "recurring_template", column: "name" }],
	"recurring.paymentSource": [
		{ table: "recurring_template", column: "paymentSource" },
	],
	"recurring.websiteUrl": [
		{ table: "recurring_template", column: "websiteUrl" },
	],
	"sharedExpense.correctionTitle": [
		{ table: "shared_transaction", column: "description" },
	],
	"shared_expense.description": [
		{ table: "shared_transaction", column: "description" },
	],
	"shared_expense.notes": [{ table: "shared_transaction", column: "notes" }],
	"shared_expense.reject_reason": [
		{ table: "split_participant", column: "rejectionReason" },
	],
	"transfer.note": [{ table: "transfer", column: "note" }],
	"user.name": [{ table: "user", column: "name" }],
	"webhook.name": [{ table: "webhook", column: "name" }],
};

/** Declared fields that no column stores (a filter, a test). */
const NOT_STORED = new Set(["expense.search"]);

const keyring = new Keyring([{ id: 1, key: randomBytes(32) }]);
const aad = { table: "t", column: "c", rowId: "r" };

/**
 * Characters of the stored value for a plaintext of `limit` UTF-16 units. The
 * limit counts UTF-16 units (zod's string max), and no unit costs more than
 * 3 UTF-8 bytes: U+0800 to U+FFFF take 3 bytes in one unit, a pair takes 4
 * bytes in two. So "€" repeated is the longest plaintext.
 */
function worstCaseStored(limit: number): number {
	return sealField(keyring, "€".repeat(limit), aad).length;
}

describe("worst-case ciphertext length", () => {
	it("is 4 * limit + 48 characters", () => {
		// "\u0001k1:" is 4; the raw bytes are 4 key id + 12 nonce + 16 tag + 3 per
		// unit, and base64 turns every 3 bytes into 4 characters.
		for (const limit of [1, 64, 500, 5000]) {
			expect(worstCaseStored(limit)).toBe(4 * limit + 48);
		}
	});
});

describe("user-text columns hold their ciphertext", () => {
	it("maps every declared field to a column, or says it is not stored", () => {
		expect(scanned.unreadable).toEqual([]);
		const declared = [...scanned.limits.keys()];
		expect(declared.length).toBeGreaterThan(30);
		const unmapped = declared.filter((f) => !STORED[f] && !NOT_STORED.has(f));
		expect(unmapped).toEqual([]);
		const stale = [...Object.keys(STORED), ...NOT_STORED].filter(
			(f) => !scanned.limits.has(f),
		);
		expect(stale).toEqual([]);
	});

	it("sees every field the loaded schemas register", () => {
		const missed = [...USER_TEXT_FIELDS].filter(
			(f) => !f.startsWith("test.") && !scanned.limits.has(f),
		);
		expect(missed).toEqual([]);
	});

	it("has a column at least as long as the worst-case ciphertext", async () => {
		const tooSmall: string[] = [];
		for (const [field, columns] of Object.entries(STORED)) {
			const limit = scanned.limits.get(field);
			expect(limit, field).toBeGreaterThan(0);
			const needed = worstCaseStored(limit ?? 0);
			for (const { table, column } of columns) {
				const rows = await adminDb.$queryRaw<
					{ data_type: string; character_maximum_length: number | null }[]
				>`SELECT data_type, character_maximum_length
					FROM information_schema.columns
					WHERE table_schema = current_schema()
						AND table_name = ${table} AND column_name = ${column}`;
				expect(rows, `${table}.${column} exists`).toHaveLength(1);
				const row = rows[0];
				if (row?.data_type === "text") continue;
				const capacity = row?.character_maximum_length ?? 0;
				if (capacity < needed)
					tooSmall.push(
						`${field}: ${table}.${column} holds ${capacity}, needs ${needed}`,
					);
			}
		}
		expect(tooSmall).toEqual([]);
	});

	it("stores the longest category name ciphertext", async () => {
		const { user } = await createTestUser();
		const limit = scanned.limits.get("category.name") ?? 0;
		const sealed = sealField(keyring, "€".repeat(limit), aad);
		const row = await adminDb.category.create({
			data: { userId: user.id, name: sealed, color: "teal", kind: "EXPENSE" },
		});
		expect(row.name).toBe(sealed);
		expect(sealed.length).toBe(4 * limit + 48);
	});
});
