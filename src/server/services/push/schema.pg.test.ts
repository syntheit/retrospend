/**
 * The push tables as the migrations leave them: the fan-out's queue index,
 * and the push_preference migration (the new switch, its backfill from the
 * in-app switch, the new type, and a second run changing nothing).
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateNotificationPreferences } from "~/server/services/notifications";
import { adminDb, createTestUser } from "./pg-fixtures";

// Found by name: the folder's timestamp is assigned when it is merged.
const MIGRATIONS = join(process.cwd(), "prisma/migrations");
const folder = readdirSync(MIGRATIONS).find((name) =>
	name.endsWith("_push_preference"),
);
if (!folder) throw new Error("The push_preference migration is missing");
const MIGRATION = readFileSync(
	join(MIGRATIONS, folder, "migration.sql"),
	"utf8",
);

describe("push schema", () => {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	let userId: string;

	beforeAll(async () => {
		await client.connect();
		userId = (await createTestUser()).user.id;
	});

	afterAll(async () => {
		await client.end();
	});

	it("has the partial index the fan-out reads its queue from", async () => {
		const { rows } = await client.query<{ indexdef: string }>(
			`SELECT indexdef FROM pg_indexes
			  WHERE tablename = 'api_event' AND indexname = 'api_event_unpushed_idx'`,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.indexdef).toContain("btree (txid)");
		expect(rows[0]?.indexdef).toContain('"pushedAt" IS NULL');
	});

	it("adds a push switch that is on unless said otherwise, and a recurring type", async () => {
		const row = await adminDb.notificationPreference.create({
			data: { userId, type: "RECURRING_DUE" },
		});
		expect(row).toMatchObject({ push: true, inApp: true });
	});

	it("starts push on a new row as the in-app switch says, when a write leaves it out", async () => {
		await updateNotificationPreferences(adminDb, userId, [
			{ type: "PERIOD_CLOSED", inApp: false, email: false, digestMode: false },
			{
				type: "PARTICIPANT_ADDED",
				inApp: true,
				email: false,
				digestMode: false,
			},
			{
				type: "EXPENSE_DELETED",
				inApp: false,
				push: true,
				email: false,
				digestMode: false,
			},
		]);
		const rows = await adminDb.notificationPreference.findMany({
			where: {
				userId,
				type: { in: ["PERIOD_CLOSED", "PARTICIPANT_ADDED", "EXPENSE_DELETED"] },
			},
		});
		expect(Object.fromEntries(rows.map((r) => [r.type, r.push]))).toEqual({
			PERIOD_CLOSED: false,
			PARTICIPANT_ADDED: true,
			EXPENSE_DELETED: true,
		});
	});

	it("starts each existing row with its in-app value, once", async () => {
		await client.query("BEGIN");
		try {
			// The table as it was before the migration.
			await client.query(
				'ALTER TABLE "notification_preference" DROP COLUMN "push"',
			);
			const off = randomUUID();
			const on = randomUUID();
			await client.query(
				`INSERT INTO "notification_preference" ("id", "userId", "type", "inApp")
				 VALUES ($1, $3, 'EXPENSE_SPLIT', false), ($2, $3, 'EXPENSE_EDITED', true)`,
				[off, on, userId],
			);

			await client.query(MIGRATION);
			const read = async () =>
				(
					await client.query<{ id: string; push: boolean }>(
						`SELECT "id", "push" FROM "notification_preference" WHERE "id" = ANY($1)`,
						[[off, on]],
					)
				).rows;
			expect(await read()).toEqual(
				expect.arrayContaining([
					{ id: off, push: false },
					{ id: on, push: true },
				]),
			);

			// A choice made afterwards survives a second run.
			await client.query(
				`UPDATE "notification_preference" SET "push" = true WHERE "id" = $1`,
				[off],
			);
			await client.query(MIGRATION);
			expect(await read()).toEqual(
				expect.arrayContaining([{ id: off, push: true }]),
			);

			// New rows default to on, and the column cannot be null.
			const { rows } = await client.query<{
				is_nullable: string;
				column_default: string;
			}>(
				`SELECT is_nullable, column_default FROM information_schema.columns
				  WHERE table_name = 'notification_preference' AND column_name = 'push'`,
			);
			expect(rows[0]).toEqual({ is_nullable: "NO", column_default: "true" });
		} finally {
			await client.query("ROLLBACK");
		}
	});
});
