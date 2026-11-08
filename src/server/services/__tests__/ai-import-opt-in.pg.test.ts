/**
 * The AI import setting on a real Postgres: off for a new account, readable
 * and writable by its owner under RLS, and the migration switches on only the
 * accounts that already used AI import, once. The migration adds a column, so
 * the test drops it, runs the file, and leaves the column as it found it.
 * Files in one worker run one at a time, so the dropped column is never seen
 * by another file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isAiImportEnabled } from "~/server/services/ai-access.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

const MIGRATION = readFileSync(
	resolve(
		process.cwd(),
		"prisma/migrations/20261108200000_ai_import_opt_in/migration.sql",
	),
	"utf8",
);

async function importJob(userId: string, type: "CSV" | "BANK_STATEMENT") {
	await adminDb.importJob.create({
		data: {
			id: randomUUID(),
			userId,
			type,
			status: "COMPLETED",
			fileName: "f",
			fileSize: 1,
			fileType: type === "CSV" ? "csv" : "pdf",
		},
	});
}

async function flags(ids: string[]) {
	const rows = await adminDb.$queryRaw<
		{ id: string; on: boolean }[]
	>`SELECT id, "aiImportEnabled" AS "on" FROM "user" WHERE id = ANY(${ids})`;
	return new Map(rows.map((r) => [r.id, r.on]));
}

describe("aiImportEnabled", () => {
	let external: string;
	let tokens: string;
	let statement: string;
	let nothing: string;
	let csvOnly: string;
	let zeroTokens: string;

	beforeAll(async () => {
		external = (await createTestUser()).user.id;
		tokens = (await createTestUser()).user.id;
		statement = (await createTestUser()).user.id;
		nothing = (await createTestUser()).user.id;
		csvOnly = (await createTestUser()).user.id;
		zeroTokens = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: external },
			data: { aiMode: "EXTERNAL" },
		});
		await adminDb.aiUsage.create({
			data: { userId: tokens, yearMonth: "2026-09", tokensUsed: 40 },
		});
		await adminDb.aiUsage.create({
			data: { userId: zeroTokens, yearMonth: "2026-09", tokensUsed: 0 },
		});
		await importJob(statement, "BANK_STATEMENT");
		await importJob(csvOnly, "CSV");
	});

	it("is off for a new account", async () => {
		const fresh = await createTestUser();
		expect(await isAiImportEnabled(fresh.db, fresh.user.id)).toBe(false);
	});

	it("is read and written by its owner under RLS", async () => {
		const me = await createTestUser();
		await me.db.user.update({
			where: { id: me.user.id },
			data: { aiImportEnabled: true },
		});
		expect(await isAiImportEnabled(me.db, me.user.id)).toBe(true);
		await me.db.user.update({
			where: { id: me.user.id },
			data: { aiImportEnabled: false },
		});
		expect(await isAiImportEnabled(me.db, me.user.id)).toBe(false);
	});

	it("the migration keeps AI import on for accounts that used it, once", async () => {
		try {
			await adminDb.$executeRawUnsafe(
				'ALTER TABLE "user" DROP COLUMN "aiImportEnabled"',
			);
			await adminDb.$executeRawUnsafe(MIGRATION);

			const ids = [external, tokens, statement, nothing, csvOnly, zeroTokens];
			const first = await flags(ids);
			expect(first.get(external)).toBe(true);
			expect(first.get(tokens)).toBe(true);
			expect(first.get(statement)).toBe(true);
			expect(first.get(nothing)).toBe(false);
			expect(first.get(csvOnly)).toBe(false);
			expect(first.get(zeroTokens)).toBe(false);

			// An account that turned it off stays off when the file runs again.
			await adminDb.$executeRawUnsafe(
				`UPDATE "user" SET "aiImportEnabled" = false WHERE id = '${tokens}'`,
			);
			await adminDb.$executeRawUnsafe(MIGRATION);
			const second = await flags(ids);
			expect(second.get(tokens)).toBe(false);
			expect(second.get(external)).toBe(true);
		} finally {
			await adminDb.$executeRawUnsafe(
				'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "aiImportEnabled" BOOLEAN NOT NULL DEFAULT false',
			);
		}
	});
});
