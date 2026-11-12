/**
 * Migration 20261112100000_account_leg_half_even: the account leg trigger
 * rounds every USD value half to even (round_half_even) and moves an
 * account's snapshots oldest first, whatever plan reads them. Legs are written
 * as retrospend_app, as the app writes them, so the helper's grant is checked
 * too. Every expected value is derived by hand in its comment; the old trigger
 * (ROUND and the numeric(12,2) cast, half away from zero) gave the other
 * neighbor on each tie.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Dec, dec } from "@retrospend/domain/precise-decimal";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { AssetType } from "~prisma";

const MIGRATION = "20261112100000_account_leg_half_even";
const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

let userId: string;
let userDb: Awaited<ReturnType<typeof createTestUser>>["db"];
let transferId: string;
let serial = 0;

beforeAll(async () => {
	const { user, db } = await createTestUser();
	userId = user.id;
	userDb = db;
	const transfer = await fixtureDb.transfer.create({
		data: {
			userId,
			kind: "TRANSFER",
			date: new Date(T0),
			fromAmount: "1",
			fromCurrency: "ARS",
			toAmount: "1",
			toCurrency: "ARS",
		},
	});
	transferId = transfer.id;
});

afterAll(async () => {
	await adminDb.user.delete({ where: { id: userId } });
});

async function account(
	currency: string,
	balance: string,
	options: { type?: AssetType; exchangeRate?: string } = {},
) {
	const id = `hev-${serial++}-${Math.random().toString(36).slice(2, 8)}`;
	await fixtureDb.assetAccount.create({
		data: {
			id,
			userId,
			name: id,
			type: options.type ?? "CASH",
			currency,
			balance,
			exchangeRate: options.exchangeRate ?? null,
		},
	});
	return id;
}

/** A balance update on day `n` (from 0), recorded after every leg below. */
async function snapshot(
	accountId: string,
	n: number,
	balance: string,
	balanceInUSD: string,
) {
	const id = `${accountId}-s${n}`;
	await adminDb.assetSnapshot.create({
		data: {
			id,
			userId,
			accountId,
			date: new Date(T0 + n * DAY),
			balance,
			balanceInUSD,
			recordedAt: new Date(T0 + 30 * DAY),
		},
	});
	return id;
}

/**
 * A transfer leg on day 0 as retrospend_app; `heap` turns index scans off, so
 * the trigger's queries read asset_snapshot in heap order.
 */
async function leg(accountId: string, amount: string, heap = false) {
	await userTransaction(userDb, userId, async (tx) => {
		if (heap) {
			await tx.$executeRaw`SET LOCAL enable_indexscan = off`;
			await tx.$executeRaw`SET LOCAL enable_indexonlyscan = off`;
			await tx.$executeRaw`SET LOCAL enable_bitmapscan = off`;
		}
		await tx.accountLeg.create({
			data: {
				userId,
				accountId,
				currency: "USD",
				amount,
				date: new Date(T0),
				source: "TRANSFER",
				transferId,
				createdAt: new Date(T0),
			},
		});
	});
}

/** "balance / balanceInUSD" of a snapshot, as Postgres prints them. */
async function snap(id: string) {
	const row = await adminDb.assetSnapshot.findUniqueOrThrow({ where: { id } });
	return `${row.balance.toFixed()} / ${row.balanceInUSD.toFixed(2)}`;
}

describe("round_half_even", () => {
	const cases: [string, number, string][] = [
		// Ties: the even neighbor, by magnitude.
		["0.125", 2, "0.12"],
		["0.135", 2, "0.14"],
		["0.005", 2, "0.00"],
		["0.015", 2, "0.02"],
		["1.005", 2, "1.00"],
		["2179.845", 2, "2179.84"],
		["-0.125", 2, "-0.12"],
		["-0.135", 2, "-0.14"],
		["-0.005", 2, "0.00"],
		["-1.025", 2, "-1.02"],
		["28.5", 0, "28"],
		["29.5", 0, "30"],
		["-28.5", 0, "-28"],
		["1.2345", 3, "1.234"],
		["1.2355", 3, "1.236"],
		["0.000000005", 8, "0.00000000"],
		["0.000000015", 8, "0.00000002"],
		// Not ties: nearest, as ROUND.
		["0.124999", 2, "0.12"],
		["0.125001", 2, "0.13"],
		["-0.125001", 2, "-0.13"],
		["99999999.994999", 2, "99999999.99"],
		["7", 2, "7.00"],
	];

	it("rounds ties to the even neighbor and keeps the scale", async () => {
		const rows = await adminDb.$queryRaw<{ out: string }[]>`
			SELECT round_half_even(v::numeric, p)::text AS out
			FROM unnest(${cases.map((c) => c[0])}::text[], ${cases.map((c) => c[1])}::int[])
				WITH ORDINALITY AS t(v, p, i)
			ORDER BY i`;
		expect(rows.map((r) => r.out)).toEqual(cases.map((c) => c[2]));
	});

	it("agrees with the domain's half even on random values, ties included", async () => {
		let a = 4_2026;
		const next = () => {
			a = (a * 1103515245 + 12345) % 2 ** 31;
			return a;
		};
		const values = Array.from({ length: 2000 }, (_, i) => {
			// Every fourth value is an exact tie at 2 decimals.
			const cents = (next() % 2_000_001) - 1_000_000;
			const tail = i % 4 === 0 ? "5" : String(next() % 100_000);
			return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}${tail}`;
		});
		const rows = await adminDb.$queryRaw<{ out: string }[]>`
			SELECT round_half_even(v::numeric, 2)::text AS out
			FROM unnest(${values}::text[]) WITH ORDINALITY AS t(v, i)
			ORDER BY i`;
		rows.forEach((row, i) => {
			const v = values[i] as string;
			expect(row.out, v).toBe(
				dec(v).toDecimalPlaces(2, Dec.ROUND_HALF_EVEN).plus(0).toFixed(2),
			);
		});
	});

	it("is null on null, so the trigger keeps a USD value it cannot price", async () => {
		const [row] = await adminDb.$queryRaw<{ out: string | null }[]>`
			SELECT round_half_even(NULL::numeric, 2)::text AS out`;
		expect(row?.out).toBeNull();
	});
});

describe("the account leg trigger rounds half to even", () => {
	it("a USD snapshot's balance to cents", async () => {
		const id = await account("USD", "1");
		const up = await snapshot(id, 0, "1", "1");
		const down = await snapshot(id, 1, "-1.03", "-1.03");
		const odd = await snapshot(id, 2, "-1.02", "-1.02");
		await leg(id, "0.005");
		// 1.005 to 1.00 (old cast 1.01); -1.025 to -1.02 (old -1.03); -1.015 to
		// -1.02, its lower magnitude 1.01 is odd (the old cast agreed).
		expect(await snap(up)).toBe("1.005 / 1.00");
		expect(await snap(down)).toBe("-1.025 / -1.02");
		expect(await snap(odd)).toBe("-1.015 / -1.02");
	});

	it("an ARS snapshot scaled by its balance, either sign", async () => {
		const plus = await account("ARS", "2", { exchangeRate: "1545" });
		const s1 = await snapshot(plus, 0, "2", "0.05");
		await leg(plus, "3");
		// 0.05 * 5 / 2 = 0.125 to 0.12 (old 0.13).
		expect(await snap(s1)).toBe("5 / 0.12");

		const minus = await account("ARS", "-2", { exchangeRate: "1545" });
		const s2 = await snapshot(minus, 0, "-2", "-0.05");
		await leg(minus, "-3");
		// -0.05 * -5 / -2 = -0.125 to -0.12 (old -0.13).
		expect(await snap(s2)).toBe("-5 / -0.12");
	});

	it("a JPY and a KWD snapshot scaled onto a tie", async () => {
		const jpy = await account("JPY", "2", { exchangeRate: "150" });
		const s1 = await snapshot(jpy, 0, "2", "0.05");
		await leg(jpy, "3");
		// 0.05 * 5 / 2 = 0.125 to 0.12.
		expect(await snap(s1)).toBe("5 / 0.12");

		const kwd = await account("KWD", "0.002", { exchangeRate: "0.307" });
		const s2 = await snapshot(kwd, 0, "0.002", "0.05");
		await leg(kwd, "0.003");
		// 0.05 * 0.005 / 0.002 = 0.125 to 0.12.
		expect(await snap(s2)).toBe("0.005 / 0.12");
	});

	it("a liability snapshot, which moves the other way", async () => {
		const card = await account("ARS", "8", {
			type: "LIABILITY_CREDIT_CARD",
			exchangeRate: "1545",
		});
		const s = await snapshot(card, 0, "8", "-1");
		// A payment of 3 lowers what is owed: effect -3, balance 5.
		await leg(card, "3");
		// -1 * 5 / 8 = -0.625 to -0.62 (old -0.63).
		expect(await snap(s)).toBe("5 / -0.62");
	});

	it("a zero snapshot priced at 1 / rate", async () => {
		const ars = await account("ARS", "0", { exchangeRate: "200" });
		const s1 = await snapshot(ars, 0, "0", "0");
		await leg(ars, "1");
		// 1 / 200 = 0.005 USD per peso: 0.005 to 0.00 (old 0.01).
		expect(await snap(s1)).toBe("1 / 0.00");

		const neg = await account("ARS", "0", { exchangeRate: "200" });
		const s2 = await snapshot(neg, 0, "0", "0");
		await leg(neg, "-5");
		// -5 x 0.005 = -0.025 to -0.02 (old -0.03).
		expect(await snap(s2)).toBe("-5 / -0.02");

		const blue = await account("ARS", "0", { exchangeRate: "1545" });
		const s3 = await snapshot(blue, 0, "0", "0");
		await leg(blue, "15450");
		// 1 / 1545 = 0.00064724919093851133 (20 decimals); x 15450 = 10.00000...
		expect(await snap(s3)).toBe("15450 / 10.00");
	});

	it("a zero crypto snapshot priced at its rate", async () => {
		const btc = await account("BTC", "0", {
			type: "CRYPTO",
			exchangeRate: "50",
		});
		const s1 = await snapshot(btc, 0, "0", "0");
		await leg(btc, "0.0001");
		// 0.0001 x 50 = 0.005 to 0.00 (old 0.01).
		expect(await snap(s1)).toBe("0.0001 / 0.00");

		const out = await account("BTC", "0", {
			type: "CRYPTO",
			exchangeRate: "50",
		});
		const s2 = await snapshot(out, 0, "0", "0");
		await leg(out, "-0.0003");
		// -0.0003 x 50 = -0.015 to -0.02: 1 is odd (the old ROUND agreed).
		expect(await snap(s2)).toBe("-0.0003 / -0.02");
	});
});

describe("the account leg trigger moves snapshots oldest first", () => {
	it("in heap order too, so a zero snapshot is priced before the later one moves", async () => {
		const id = await account("ARS", "2", { exchangeRate: "1545" });
		// Written later day first, so a sequential scan meets it first.
		const later = await snapshot(id, 1, "2", "0.01");
		const zero = await snapshot(id, 0, "0", "0");
		await leg(id, "1", true);
		// 'zero' first: 0.01 / 2 = 0.005 USD per peso, 1 x 0.005 = 0.005 to
		// 0.00. Then 'later': 0.01 * 3 / 2 = 0.015 to 0.02. In heap order the
		// old trigger moved 'later' first and priced 'zero' at 0.02 / 3: 0.01.
		expect(await snap(zero)).toBe("1 / 0.00");
		expect(await snap(later)).toBe("3 / 0.02");
		const row = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(row.balance.toFixed()).toBe("3");
	});
});

describe("the migration and its rollback", () => {
	const read = (...parts: string[]) =>
		readFileSync(join(REPO_ROOT, ...parts), "utf8");
	const migration = read("prisma/migrations", MIGRATION, "migration.sql");
	const snippet = read("prisma/rollback", `${MIGRATION}.sql`);
	/** account_leg_apply's body as 20261024300000 wrote it. */
	const original =
		/CREATE OR REPLACE FUNCTION account_leg_apply[\s\S]*?AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/.exec(
			read(
				"prisma/migrations",
				"20261024300000_accounts_legs_transfers",
				"migration.sql",
			),
		)?.[1];

	const state = async (client: Client) =>
		(
			await client.query<{
				body: string;
				acl: string | null;
				helper: string | null;
				helperAcl: string | null;
			}>(`
				SELECT p.prosrc AS body, p.proacl::text AS acl,
				       to_regprocedure('round_half_even(numeric, integer)')::text AS helper,
				       (SELECT h.proacl::text FROM pg_proc h
				         WHERE h.oid = to_regprocedure('round_half_even(numeric, integer)')) AS "helperAcl"
				FROM pg_proc p
				WHERE p.oid = 'account_leg_apply(account_leg, integer, boolean)'::regprocedure`)
		).rows[0];

	it("puts the old trigger back, drops the helper, and the migration comes back", async () => {
		expect(original).toContain('ROUND(s."balanceInUSD"');
		await inRolledBackTransaction(async (client) => {
			const migrated = await state(client);
			expect(migrated?.body).toContain("round_half_even");
			expect(migrated?.helper).toBe("round_half_even(numeric,integer)");
			// retrospend_app executes it; PUBLIC does not.
			expect(migrated?.helperAcl).toMatch(/retrospend_app=X/);
			expect(migrated?.helperAcl).not.toMatch(/(^|[{,])=X/);

			await client.query(snippet);
			await client.query(snippet);
			const rolledBack = await state(client);
			expect(rolledBack?.body).toBe(original);
			expect(rolledBack?.helper).toBeNull();
			expect(rolledBack?.acl).toBe(migrated?.acl);

			await client.query(migration);
			await client.query(migration);
			expect(await state(client)).toEqual(migrated);
		});
	});
});
