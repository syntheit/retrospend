// scripts/verify-sealing.ts reports what is sealed, in a read-only session,
// and fails on plaintext written after the epoch. These tests plant cells
// with explicit timestamps (the epoch is 2098, planted rows are 2090 or 2099),
// so rows other files left in this worker's database never count as "after".
// Counts are compared with a baseline taken first, for the same reason.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	type CellReport,
	formatReport,
	judge,
	openReadOnlySession,
	runVerify,
	type SealingReport,
	verifySealing,
} from "../../scripts/verify-sealing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SEALED = "\u0001k1:AAAAAQ==";
const BEFORE = "2090-01-01T00:00:00Z";
const AFTER = "2099-01-01T00:00:00Z";
const SECRETS = ["PLANT-NAME", "PLANT-BODY", "PLANT-LEAF", "PLANT-UNDECLARED"];

let userId: string;
let epochBefore: Date | null;
const planted: {
	apikey: string[];
	idem: string[];
	audit: string[];
	ghost: string[];
} = {
	apikey: [],
	idem: [],
	audit: [],
	ghost: [],
};

async function key(name: string, created: string, updated: string) {
	const id = randomUUID();
	planted.apikey.push(id);
	await adminDb.$executeRaw`
		INSERT INTO "apikey" ("id", "key", "referenceId", "name", "createdAt", "updatedAt")
		VALUES (${id}, ${randomUUID()}, ${userId}, ${name}, ${created}::timestamp, ${updated}::timestamp)`;
}
async function body(responseBody: unknown, created: string) {
	const id = randomUUID();
	planted.idem.push(id);
	await adminDb.$executeRaw`
		INSERT INTO "idempotency_key" ("id", "userId", "key", "requestHash", "responseBody", "createdAt", "expiresAt")
		VALUES (${id}, ${userId}, ${randomUUID()}, 'h', ${JSON.stringify(responseBody)}::jsonb,
		        ${created}::timestamp, ${AFTER}::timestamp)`;
}
async function audit(changes: unknown, at: string) {
	const id = randomUUID();
	planted.audit.push(id);
	await adminDb.$executeRaw`
		INSERT INTO "audit_log_entry" ("id", "timestamp", "actorType", "actorId", "action", "targetType", "targetId", "changes")
		VALUES (${id}, ${at}::timestamp, (enum_range(NULL::"ParticipantType"))[1], ${userId},
		        (enum_range(NULL::"AuditAction"))[1], (enum_range(NULL::"AuditTargetType"))[1], 'target',
		        ${JSON.stringify(changes)}::jsonb)`;
}
async function ghost(email: string | null, emailHash: string | null) {
	const id = randomUUID();
	planted.ghost.push(id);
	await adminDb.$executeRaw`
		INSERT INTO "shadow_profile" ("id", "createdById", "name", "email", "emailHash")
		VALUES (${id}, ${userId}, 'Ghost', ${email}, ${emailHash})`;
}

async function clean() {
	await adminDb.$executeRaw`DELETE FROM "apikey" WHERE "id" = ANY(${planted.apikey})`;
	await adminDb.$executeRaw`DELETE FROM "idempotency_key" WHERE "id" = ANY(${planted.idem})`;
	await adminDb.$executeRaw`DELETE FROM "audit_log_entry" WHERE "id" = ANY(${planted.audit})`;
	await adminDb.$executeRaw`DELETE FROM "shadow_profile" WHERE "id" = ANY(${planted.ghost})`;
	for (const list of Object.values(planted)) list.length = 0;
}

const setEpoch = (at: string | null) =>
	adminDb.$executeRaw`
		INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
		VALUES ('app_settings_singleton', now(), ${at}::timestamp)
		ON CONFLICT ("id") DO UPDATE SET "fieldEncryptionSince" = EXCLUDED."fieldEncryptionSince"`;

const report = async () => {
	const client = await openReadOnlySession(pool);
	try {
		return await verifySealing(client);
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
};
const cell = (r: SealingReport, name: string): CellReport => {
	const found = r.cells.find((c) => c.cell === name);
	if (!found) throw new Error(`${name} is not reported`);
	return found;
};
const strict = { createdOnly: false };

beforeAll(async () => {
	userId = (await createTestUser()).user.id;
	const [row] = await adminDb.$queryRaw<{ since: Date | null }[]>`
		SELECT "fieldEncryptionSince" AS "since" FROM "app_settings"`;
	epochBefore = row?.since ?? null;
	await setEpoch("2098-01-01T00:00:00Z");
});
afterEach(clean);
afterAll(async () => {
	await clean();
	await setEpoch(epochBefore?.toISOString() ?? null);
	await pool.end();
});

describe("verify-sealing", () => {
	it("reports every mapped column and JSON cell of the migrated database", async () => {
		const r = await report();
		expect(r.cells.filter((c) => c.rows === null)).toEqual([]);
		expect(r.epoch).toBe("2098-01-01T00:00:00Z");
		expect(r.buildFloor).toBeGreaterThanOrEqual(1);
		for (const name of [
			"expense.title",
			"user.name",
			"idempotency_key.responseBody",
			"import_job.transactions",
			"audit_log_entry.changes",
			"audit_log_entry.changes (undeclared leaf)",
		])
			expect(cell(r, name)).toBeDefined();
	});

	it("passes on sealed cells and on legacy plaintext older than the epoch, counting both", async () => {
		const base = await report();
		await key("PLANT-NAME", BEFORE, BEFORE);
		await key(SEALED, AFTER, AFTER);
		await body({ sealed: SEALED }, AFTER);
		await audit({ name: SEALED }, AFTER);
		const r = await report();
		expect(cell(r, "apikey.name")).toMatchObject({
			plaintext: cell(base, "apikey.name").plaintext + 1,
			sealed: cell(base, "apikey.name").sealed + 1,
		});
		expect(cell(r, "idempotency_key.responseBody").sealed).toBe(
			cell(base, "idempotency_key.responseBody").sealed + 1,
		);
		expect(cell(r, "audit_log_entry.changes").sealed).toBe(
			cell(base, "audit_log_entry.changes").sealed + 1,
		);
		expect(judge(r, strict).violations).toBe(0);
		const lines: string[] = [];
		expect(await runVerify(pool, strict, (t) => lines.push(t))).toBe(0);
	});

	it("fails on plaintext in a row created after the epoch", async () => {
		await key("PLANT-NAME", AFTER, AFTER);
		const r = await report();
		expect(cell(r, "apikey.name").createdAfter).toBe(1);
		expect(judge(r, strict).violations).toBe(1);
		expect(judge(r, { createdOnly: true }).violations).toBe(1);
		expect(await runVerify(pool, strict, () => {})).toBe(1);
	});

	it("fails on plaintext in a row updated after the epoch, unless --created-only", async () => {
		await key("PLANT-NAME", BEFORE, AFTER);
		const r = await report();
		expect(cell(r, "apikey.name")).toMatchObject({
			createdAfter: 0,
			updatedAfter: 1,
		});
		expect(judge(r, strict).violations).toBe(1);
		expect(judge(r, { createdOnly: true }).violations).toBe(0);
		expect(await runVerify(pool, strict, () => {})).toBe(1);
		expect(await runVerify(pool, { createdOnly: true }, () => {})).toBe(0);
	});

	it("fails on a plaintext JSON body, a plaintext declared leaf and an undeclared leaf after the epoch", async () => {
		await body({ rows: "PLANT-BODY" }, AFTER);
		await audit(
			{ name: "PLANT-LEAF", "not-declared-anywhere": "PLANT-UNDECLARED" },
			AFTER,
		);
		const r = await report();
		expect(cell(r, "idempotency_key.responseBody").createdAfter).toBe(1);
		expect(cell(r, "audit_log_entry.changes").createdAfter).toBe(1);
		expect(
			cell(r, "audit_log_entry.changes (undeclared leaf)").createdAfter,
		).toBe(1);
		expect(judge(r, strict).violations).toBe(3);
	});

	it("lists a confirm's plaintext previous copy apart: in the baseline, not after the epoch", async () => {
		const base = await report();
		await audit({ previous: { paymentMethod: "PLANT-COPY" } }, AFTER);
		const r = await report();
		const changes = cell(r, "audit_log_entry.changes");
		expect(changes).toMatchObject({
			plaintext: cell(base, "audit_log_entry.changes").plaintext + 1,
			legacyCopies: cell(base, "audit_log_entry.changes").legacyCopies + 1,
			createdAfter: 0,
			updatedAfter: 0,
		});
		expect(judge(r, strict).violations).toBe(0);
		const lines: string[] = [];
		expect(await runVerify(pool, strict, (t) => lines.push(t))).toBe(0);
		expect(lines.join("\n")).toMatch(
			/Legacy copies .*: \d+ in .*audit_log_entry\.changes/,
		);
		expect(lines.join("\n")).not.toContain("PLANT-COPY");
	});

	it("still fails on a plaintext leaf outside previous, next to a legacy copy", async () => {
		await audit(
			{ previous: { paymentMethod: "PLANT-COPY" }, name: "PLANT-LEAF" },
			AFTER,
		);
		const r = await report();
		expect(cell(r, "audit_log_entry.changes")).toMatchObject({
			createdAfter: 1,
		});
		expect(judge(r, strict).violations).toBe(1);
		expect(await runVerify(pool, strict, () => {})).toBe(1);
	});

	it("has no after-epoch rule before the epoch, only the baseline", async () => {
		await setEpoch(null);
		try {
			await key("PLANT-NAME", AFTER, AFTER);
			const r = await report();
			expect(r.epoch).toBeNull();
			expect(judge(r, strict).violations).toBe(0);
			expect(formatReport(r, judge(r, strict), strict)).toMatch(
				/No epoch yet.*baseline/,
			);
		} finally {
			await setEpoch("2098-01-01T00:00:00Z");
		}
	});

	it("lists the tables with no timestamps, as the catalog has them", async () => {
		const r = await report();
		const listed = r.cells
			.filter((c) => c.noTimestamps)
			.map((c) => c.cell.split(" ")[0]?.split(".")[0]);
		const { rows } = await pool.query<{ table_name: string }>(`
			SELECT DISTINCT table_name FROM information_schema.columns
			WHERE table_schema = current_schema() AND column_name IN ('createdAt', 'updatedAt', 'timestamp')`);
		const dated = new Set(rows.map((x) => x.table_name));
		expect(listed.length).toBeGreaterThan(0);
		expect(listed).toContain("category");
		for (const table of listed) expect(dated.has(table ?? "")).toBe(false);
		expect(formatReport(r, judge(r, strict), strict)).toMatch(
			/Tables with no createdAt or updatedAt \(baseline only\): .*category\.name/,
		);
	});

	it("counts contact addresses with and without a hash", async () => {
		const base = (await report()).contacts.find(
			(c) => c.table === "shadow_profile",
		);
		await ghost("PLANT-ADDRESS@example.com", null);
		await ghost("PLANT-ADDRESS2@example.com", "tag:hash");
		await ghost(null, null);
		const now = (await report()).contacts.find(
			(c) => c.table === "shadow_profile",
		);
		expect(now?.withAddress).toBe((base?.withAddress ?? 0) + 2);
		expect(now?.withHash).toBe((base?.withHash ?? 0) + 1);
		expect(now?.addressWithoutHash).toBe((base?.addressWithoutHash ?? 0) + 1);
	});

	it("runs in a session where a write fails", async () => {
		const client = await openReadOnlySession(pool);
		try {
			await expect(
				client.query(`UPDATE "app_settings" SET "sealingFloor" = 99`),
			).rejects.toThrow(/read-only transaction/);
			await client.query("ROLLBACK");
			// The session default, not just the transaction, is read only.
			await expect(
				client.query(`UPDATE "app_settings" SET "sealingFloor" = 99`),
			).rejects.toThrow(/read-only transaction/);
		} finally {
			await client.query("ROLLBACK").catch(() => undefined);
			client.release();
		}
		const [row] = await adminDb.$queryRaw<{ floor: number | null }[]>`
			SELECT "sealingFloor" AS "floor" FROM "app_settings"`;
		expect(row?.floor).not.toBe(99);
	});

	it("prints no user text, no address and no id, on a pass or a failure", async () => {
		await key("PLANT-NAME", AFTER, AFTER);
		await body({ rows: "PLANT-BODY" }, AFTER);
		await audit({ name: "PLANT-LEAF", x: "PLANT-UNDECLARED" }, AFTER);
		await ghost("PLANT-ADDRESS@example.com", null);
		const lines: string[] = [];
		expect(await runVerify(pool, strict, (t) => lines.push(t))).toBe(1);
		const out = lines.join("\n");
		expect(out).toMatch(/Plaintext written after the epoch: [1-9]/);
		for (const secret of [
			...SECRETS,
			"PLANT-ADDRESS",
			userId,
			...planted.apikey,
			...planted.audit,
		])
			expect(out).not.toContain(secret);
	});
});
