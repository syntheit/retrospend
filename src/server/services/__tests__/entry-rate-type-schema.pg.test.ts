/**
 * The entry_rate_type migration (M2) on a real Postgres: it reapplies
 * cleanly, maps each kind of legacy pricingSource to a rate type, leaves the
 * rows it cannot map for the deploy pre-check to count, and its CHECKs keep
 * a half-booked home leg out.
 *
 * Rates use made-up currencies so other files' rates cannot match: ZZA has
 * official 1,495 and blue 1,560 (an ARS stand-in), ZZE official 0.8787.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

const MIGRATIONS = fileURLToPath(
	new URL("../../../../prisma/migrations/", import.meta.url),
);

/** Found by suffix: the timestamp is a placeholder until merge. */
function migrationSql(): string {
	const folder = readdirSync(MIGRATIONS).find((name) =>
		name.endsWith("_entry_rate_type"),
	);
	if (!folder) throw new Error("entry_rate_type migration folder not found");
	return readFileSync(`${MIGRATIONS}${folder}/migration.sql`, "utf8");
}

/**
 * The deploy pre-check (2A.2 report), scoped to one user here because other
 * files share the database. It reads only columns that exist before M2, so
 * it runs on prod before the migration: non-USD rows whose rate type the
 * backfill cannot find.
 */
const UNMAPPABLE_SQL = `
SELECT count(*)::int AS unmappable
FROM expense e
WHERE e.currency <> 'USD'
  AND lower(btrim(e."pricingSource")) <> 'custom'
  AND NOT EXISTS (
    SELECT 1 FROM exchange_rate r
    WHERE r.currency = e.currency
      AND r.type = lower(btrim(e."pricingSource")))
  AND NOT EXISTS (
    SELECT 1 FROM exchange_rate r
    WHERE r.currency = e.currency AND r.rate = e."exchangeRate")
  AND e."userId" = $1`;

const DAY = new Date("2026-07-29T00:00:00.000Z");
const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

async function runSql<T>(sql: string, params: unknown[] = []): Promise<T[]> {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		return (await client.query(sql, params)).rows as T[];
	} finally {
		await client.end();
	}
}

describe("entry_rate_type migration", () => {
	let userId: string;
	const ids: Record<string, string> = {};

	const legacy = (
		key: string,
		currency: string,
		pricingSource: string,
		exchangeRate: number,
	) => {
		ids[key] = randomUUID();
		return {
			id: ids[key],
			userId,
			title: key,
			amount: new Prisma.Decimal(100),
			currency,
			date: at("2026-08-02"),
			amountInUSD: new Prisma.Decimal(1),
			exchangeRate: new Prisma.Decimal(exchangeRate),
			pricingSource,
		};
	};

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		await adminDb.exchangeRate.createMany({
			data: [
				{ date: DAY, currency: "ZZA", type: "official", rate: 1495 },
				{ date: DAY, currency: "ZZA", type: "blue", rate: 1560 },
				{ date: DAY, currency: "ZZE", type: "official", rate: 0.8787 },
			],
			skipDuplicates: true,
		});
		await adminDb.expense.createMany({
			data: [
				legacy("namedType", "ZZA", "blue", 1560),
				legacy("namedTypeCase", "ZZA", " Blue ", 1560),
				legacy("custom", "ZZA", "Custom", 1500),
				legacy("manualMatchesOfficial", "ZZA", "MANUAL", 1495),
				legacy("importNoMatch", "ZZA", "IMPORT", 1234),
				legacy("typeTheCurrencyLacks", "ZZE", "blue", 0.8787),
				legacy("freeText", "ZZE", "Bank statement", 0.9),
				legacy("usd", "USD", "official", 1),
			],
		});
	});

	afterAll(async () => {
		await adminDb.expense.deleteMany({ where: { userId } });
	});

	it("counts the rows it will not map before it runs", async () => {
		// importNoMatch and freeText: no type by name, no table rate equal.
		await expect(runSql(UNMAPPABLE_SQL, [userId])).resolves.toEqual([
			{ unmappable: 2 },
		]);
	});

	it("backfills the rate type each pricingSource names, on a rerun too", async () => {
		await runSql(migrationSql());
		const rows = await adminDb.expense.findMany({
			where: { userId },
			select: { id: true, rateType: true, homeCurrency: true },
		});
		const byKey = Object.fromEntries(
			Object.entries(ids).map(([key, id]) => [
				key,
				rows.find((r) => r.id === id)?.rateType,
			]),
		);
		expect(byKey).toEqual({
			namedType: "blue",
			namedTypeCase: "blue",
			custom: "custom",
			manualMatchesOfficial: "official",
			importNoMatch: null,
			typeTheCurrencyLacks: "official",
			freeText: null,
			usd: null,
		});
		// No home leg is invented for a row saved before M2.
		expect(rows.every((r) => r.homeCurrency === null)).toBe(true);
	});

	it("leaves exactly the pre-check's rows unmapped", async () => {
		const [{ left }] = await runSql<{ left: number }>(
			`SELECT count(*)::int AS left FROM expense
			 WHERE "userId" = $1 AND currency <> 'USD' AND "rateType" IS NULL`,
			[userId],
		);
		expect(left).toBe(2);
	});

	it("refuses a half-booked home leg", async () => {
		await expect(
			adminDb.expense.update({
				where: { id: ids.namedType },
				data: { homeCurrency: "USD", homeRate: null, homeAmount: null },
			}),
		).rejects.toThrow(/expense_home_leg_check/);
		await expect(
			adminDb.expense.update({
				where: { id: ids.namedType },
				data: { homeCurrency: "USD", homeRate: 0, homeAmount: 0 },
			}),
		).rejects.toThrow(/expense_home_leg_check/);
	});

	it("refuses a rate type that is not a table key", async () => {
		await expect(
			adminDb.expense.update({
				where: { id: ids.namedType },
				data: { rateType: "Blue rate" },
			}),
		).rejects.toThrow(/expense_rate_type_check/);
	});

	it("keeps the default rate types an object", async () => {
		await expect(
			adminDb.user.update({
				where: { id: userId },
				data: { defaultRateTypes: ["blue"] },
			}),
		).rejects.toThrow(/user_default_rate_types_check/);
		await expect(
			adminDb.user.findUnique({
				where: { id: userId },
				select: { defaultRateTypes: true },
			}),
		).resolves.toEqual({ defaultRateTypes: {} });
	});
});
