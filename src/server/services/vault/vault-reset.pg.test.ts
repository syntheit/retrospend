/**
 * sync_reset() and the sealed record store (20261116200000_sync_reset_restamps_vault).
 * After a restore into a new cluster, vault rows keep the txids of the old
 * cluster, above the new counter, and the reader hides everything at or above
 * the oldest open transaction. The reset restamps them. The plant is a row
 * written with the stamping trigger switched off and a txid far above the
 * counter, which is what a restored row looks like.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { SyncResetRequiredError } from "~/server/services/sync/changes";
import { until } from "~/server/services/sync/sync-test-support";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { readVaultChanges } from "./vault.service";
import { clearVault } from "./vault-db-support";
import { contextOf, type Sealer, sealer } from "./vault-test-support";

const NAME = "20261116200000_sync_reset_restamps_vault";
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

let seal: Sealer;
beforeAll(async () => {
	seal = await sealer();
});
afterAll(clearVault);

describe("sync_reset() and vault rows from another cluster", () => {
	it("makes a row whose txid is above the counter visible again, under a new epoch", async () => {
		const { user, db } = await createTestUser();
		const bytes = Buffer.from(seal(contextOf(user.id, "restored", 0)));
		await adminDb.$transaction(async (tx) => {
			await tx.$executeRaw`ALTER TABLE "vault_record" DISABLE TRIGGER vault_record_stamp`;
			await tx.$executeRaw`
				INSERT INTO "vault_record" ("userId", "id", "collectionId", "entity", "version", "ciphertext", "txid", "seq")
				VALUES (${user.id}, 'restored', 'col1', 40, 1, ${bytes}::bytea,
				        ((pg_snapshot_xmax(pg_current_snapshot())::text::numeric + 1000000)::text)::xid8, 1)`;
			await tx.$executeRaw`ALTER TABLE "vault_record" ENABLE TRIGGER vault_record_stamp`;
		});
		const page = () =>
			userTransaction(db, user.id, (tx) =>
				readVaultChanges(tx, user.id, undefined, { limit: 10 }),
			);
		const epochOf = (cursor: string) =>
			(
				JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
					e: string;
				}
			).e;

		// Hidden: its txid is above every snapshot's cut.
		const before = await page();
		expect(before.records).toEqual([]);

		await adminDb.$queryRaw`SELECT sync_reset()`;

		const after = await until(page, (p) => p.records.length === 1);
		expect(after.records.map((r) => `${r.id}:${r.version}`)).toEqual([
			"restored:1",
		]);
		// The record is what was stored: the restamp changed no byte of it.
		expect(Buffer.from(after.records[0]?.ciphertext ?? []).equals(bytes)).toBe(
			true,
		);
		expect(epochOf(after.cursor)).not.toBe(epochOf(before.cursor));
		// A cursor from before the reset is refused: the device pulls again.
		await expect(
			userTransaction(db, user.id, (tx) =>
				readVaultChanges(tx, user.id, before.cursor, { limit: 10 }),
			),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
	}, 60_000);
});

describe("the rollback snippet", () => {
	const restamps = async (client: import("pg").Client) => {
		const { rows } = await client.query(
			`SELECT position('vault_record' in prosrc) > 0 AS "restamps",
			        (SELECT count(*)::int FROM _prisma_migrations WHERE migration_name = '${NAME}') AS "record"
			 FROM pg_proc WHERE proname = 'sync_reset'`,
		);
		return rows;
	};

	it("puts the older sync_reset back, twice, and the migration restores the new one, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			expect(await restamps(client)).toEqual([{ restamps: true, record: 1 }]);
			await client.query(snippet);
			await client.query(snippet);
			expect(await restamps(client)).toEqual([{ restamps: false, record: 0 }]);
			await client.query(migration);
			await client.query(migration);
			expect(await restamps(client)).toEqual([{ restamps: true, record: 0 }]);
		});
	}, 60_000);
});
