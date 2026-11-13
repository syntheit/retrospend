/**
 * The app pool ends a connection that sits idle inside a transaction, so a
 * transaction left open cannot hold back pg_snapshot_xmin (and with it the
 * events feed and the sync cursor) for everyone. The pool then replaces the
 * ended connection: the next query succeeds.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createAppPool } from "~/server/db-core";
import {
	appPoolConfig,
	IDLE_IN_TRANSACTION_TIMEOUT_MS,
} from "~/server/db-pool-config";
import { PrismaClient } from "~prisma";

const SHORT_MS = 1000;
const WAIT_MS = 2500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const opened: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(opened.splice(0).map((close) => close()));
});

function shortPool(): Pool {
	const pool = new Pool(
		appPoolConfig(process.env.DATABASE_URL as string, SHORT_MS),
	);
	// Postgres ending an idle pooled connection is reported here, not thrown.
	pool.on("error", () => {});
	opened.push(() => pool.end());
	return pool;
}

describe("idle in transaction timeout", () => {
	// adminDb is the pool pg-env.ts built and db-core.ts reuses, so these build
	// db-core's own pool on the worker's URL instead.
	it("is set on the pool db-core builds", async () => {
		const pool = createAppPool(process.env.DATABASE_URL as string);
		opened.push(() => pool.end());
		const shown = await pool.query("SHOW idle_in_transaction_session_timeout");
		expect(IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(120_000);
		expect(shown.rows[0].idle_in_transaction_session_timeout).toBe("2min");
	});

	it("is set beside options the URL already carries", async () => {
		const url = process.env.DATABASE_URL as string;
		const joined = url.includes("?") ? "&" : "?";
		const pool = createAppPool(
			`${url}${joined}options=-c%20search_path%3Dpublic,pg_catalog`,
		);
		opened.push(() => pool.end());
		const timeout = await pool.query(
			"SHOW idle_in_transaction_session_timeout",
		);
		const path = await pool.query("SHOW search_path");
		expect(timeout.rows[0].idle_in_transaction_session_timeout).toBe("2min");
		expect(path.rows[0].search_path).toBe("public,pg_catalog");
	});

	it("ends a connection idle inside a transaction and the pool replaces it", async () => {
		const pool = shortPool();
		const client = await pool.connect();
		client.on("error", () => {});
		await client.query("BEGIN");
		const first = await client.query("SELECT pg_backend_pid() AS pid");
		await sleep(WAIT_MS);
		await expect(client.query("SELECT 1")).rejects.toThrow();
		client.release(true);

		const next = await pool.query("SELECT pg_backend_pid() AS pid");
		expect(next.rows[0].pid).not.toBe(first.rows[0].pid);
		const gone = await pool.query(
			"SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1",
			[first.rows[0].pid],
		);
		expect(gone.rows[0].n).toBe(0);
	});

	it("leaves a long statement inside a transaction alone", async () => {
		const pool = shortPool();
		const client = await pool.connect();
		await client.query("BEGIN");
		await client.query(`SELECT pg_sleep(${WAIT_MS / 1000})`);
		await client.query("COMMIT");
		client.release();
	});

	it("fails an interactive Prisma transaction that idles, then recovers", async () => {
		const pool = shortPool();
		const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
		opened.push(() => prisma.$disconnect());

		await expect(
			prisma.$transaction(
				async (tx) => {
					await tx.$queryRaw`SELECT 1`;
					await sleep(WAIT_MS);
					await tx.$queryRaw`SELECT 2`;
				},
				{ timeout: 10_000 },
			),
		).rejects.toThrow();

		const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
		expect(rows[0]?.ok).toBe(1);
	});
});
