/**
 * applyLegs() in @retrospend/domain reproduces the Postgres trigger
 * `account_leg_moves_balance` exactly. A seeded random sequence of leg
 * inserts, updates and deletes (plus balance updates and direct balance
 * writes between them) runs through the real trigger and through applyLegs in
 * memory; after every step each account's balance and counted units, and each
 * balance update's balance and USD value, must be equal to the last digit.
 *
 * Accounts cover ARS, USD, JPY, KWD (0, 2 and 3 decimals), a crypto account
 * and two liabilities. Legs carry mismatched currencies on purpose: the
 * trigger never reads a leg's currency or home value.
 */
import {
	applyLegs,
	type Leg,
	type LegAccount,
	type LegSnapshot,
	type LegState,
	pgDivide,
} from "@retrospend/domain/accounts/apply-legs";
import { Dec } from "@retrospend/domain/precise-decimal";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { AccountLegSource, AssetType } from "~prisma";

const SEED = 20261108;
const OPERATIONS = 400;

/** mulberry32: a small seeded generator, so a failure replays exactly. */
function prng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface AccountSpec {
	id: string;
	type: AssetType;
	currency: string;
	/** Decimals the currency uses, and the largest amount a leg carries. */
	dp: number;
	max: number;
	balance: string;
	exchangeRate: string | null;
}

const SPECS: AccountSpec[] = [
	{
		id: "ars",
		type: "CASH",
		currency: "ARS",
		dp: 2,
		max: 50_000,
		balance: "100000.00",
		exchangeRate: "1545",
	},
	{
		id: "usd",
		type: "CASH",
		currency: "USD",
		dp: 2,
		max: 2_000,
		balance: "500.00",
		exchangeRate: null,
	},
	{
		id: "jpy",
		type: "INVESTMENT",
		currency: "JPY",
		dp: 0,
		max: 100_000,
		balance: "300000",
		exchangeRate: "150",
	},
	{
		id: "kwd",
		type: "CASH",
		currency: "KWD",
		dp: 3,
		max: 500,
		balance: "250.500",
		exchangeRate: "0.307",
	},
	{
		id: "btc",
		type: "CRYPTO",
		currency: "BTC",
		dp: 8,
		max: 1,
		balance: "0.50000000",
		exchangeRate: "65000.5",
	},
	{
		id: "card",
		type: "LIABILITY_CREDIT_CARD",
		currency: "ARS",
		dp: 2,
		max: 20_000,
		balance: "30000.00",
		exchangeRate: "1545",
	},
	{
		id: "loan",
		type: "LIABILITY_LOAN",
		currency: "USD",
		dp: 2,
		max: 1_000,
		balance: "12000.00",
		exchangeRate: null,
	},
];

const SOURCES: AccountLegSource[] = [
	"INCOME",
	"TRANSFER",
	"FEE",
	"BALANCE_UPDATE",
];
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

interface LegRow extends Leg {
	id: string;
	transferId: string | null;
	expenseId: string | null;
	currency: string;
	homeAmount: string | null;
}

let userId: string;
let transferId: string;
let expenseId: string;
let prefix: string;
const accountId = (spec: AccountSpec) => `${prefix}-${spec.id}`;
const worlds: string[] = [];

/** A fresh user with the seven accounts, one transfer and one expense for legs to name. */
async function seedWorld() {
	prefix = `p8-${Math.random().toString(36).slice(2, 8)}`;
	const { user } = await createTestUser();
	userId = user.id;
	worlds.push(userId);
	for (const spec of SPECS) {
		await fixtureDb.assetAccount.create({
			data: {
				id: accountId(spec),
				userId,
				name: spec.id,
				type: spec.type,
				currency: spec.currency,
				balance: spec.balance,
				exchangeRate: spec.exchangeRate,
			},
		});
	}
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
	const expense = await fixtureDb.expense.create({
		data: {
			userId,
			title: "p8",
			amount: "1",
			currency: "ARS",
			date: new Date(T0),
			amountInUSD: "1",
			exchangeRate: "1",
			pricingSource: "test",
		},
	});
	expenseId = expense.id;
}

afterAll(async () => {
	for (const id of worlds) await adminDb.user.delete({ where: { id } });
});

/** What each source must carry to satisfy account_leg_source_check. */
function links(source: AccountLegSource) {
	return {
		transferId: source === "TRANSFER" || source === "FEE" ? transferId : null,
		expenseId: source === "INCOME" || source === "FEE" ? expenseId : null,
	};
}

/** A decimal string with `dp` decimals from an integer count of minor steps. */
function amountOf(steps: number, dp: number): string {
	return new Dec(steps).div(new Dec(10).pow(dp)).toFixed(dp);
}

const dbLeg = (row: LegRow) => ({
	id: row.id,
	userId,
	accountId: row.accountId,
	currency: row.currency,
	amount: row.amount.toString(),
	homeAmount: row.homeAmount,
	homeCurrency: row.homeAmount === null ? null : "USD",
	date: row.date,
	source: row.source,
	transferId: row.transferId,
	expenseId: row.expenseId,
	countedUnits: row.countedUnits.toString(),
	createdAt: row.createdAt,
});

const toLeg = (row: LegRow): Leg => ({
	accountId: row.accountId,
	amount: row.amount,
	date: row.date,
	createdAt: row.createdAt,
	source: row.source,
	countedUnits: row.countedUnits,
});

/** Postgres refuses a value a column cannot hold; the domain throws a RangeError. */
const isOverflow = (error: unknown) =>
	/numeric field overflow|out of range/i.test(String(error));

async function readDb() {
	const accounts = await fixtureDb.assetAccount.findMany({ where: { userId } });
	const snapshots = await adminDb.assetSnapshot.findMany({ where: { userId } });
	return { accounts, snapshots };
}

async function runSequence(seed: number, operations: number, ties = false) {
	await seedWorld();
	const random = prng(seed);
	const int = (lo: number, hi: number) =>
		lo + Math.floor(random() * (hi - lo + 1));
	const pick = <T>(items: readonly T[]): T =>
		items[int(0, items.length - 1)] as T;
	const chance = (p: number) => random() < p;

	const specs = SPECS.map((spec) => ({ ...spec, id: accountId(spec) }));
	const specOf = (id: string | null) => specs.find((spec) => spec.id === id);

	// The memory model: starts equal to what beforeAll wrote.
	const accounts = new Map<string, LegAccount>(
		specs.map((spec) => [
			spec.id,
			{
				type: spec.type,
				currency: spec.currency,
				balance: spec.balance,
				countedUnits: "0",
				exchangeRate: spec.exchangeRate,
			},
		]),
	);
	let snapshots: LegSnapshot[] = [];
	const legs = new Map<string, LegRow>();
	let serial = 0;
	const log: string[] = [];
	const stats = {
		insert: 0,
		update: 0,
		delete: 0,
		snapshot: 0,
		balance: 0,
		overflow: 0,
	};

	const stamp = () =>
		new Date(
			T0 + int(0, 12) * DAY + (chance(0.5) ? 0 : int(0, 23) * 3_600_000),
		);

	function randomAmount(spec: AccountSpec | undefined): string {
		const s = spec ?? pick(specs);
		// Small whole amounts against small balances land on rounding ties often.
		if (ties) return amountOf(int(-12, 12) * 10 ** s.dp, s.dp);
		if (chance(0.05)) return amountOf(0, s.dp);
		return amountOf(int(-s.max * 10 ** s.dp, s.max * 10 ** s.dp), s.dp);
	}

	function randomLeg(): LegRow {
		const source = pick(SOURCES);
		const needsAccount = source === "INCOME" || source === "BALANCE_UPDATE";
		const spec = !needsAccount && chance(0.12) ? undefined : pick(specs);
		const counted =
			chance(0.3) && spec
				? amountOf(int(0, spec.max * 10 ** spec.dp), spec.dp)
				: "0";
		return {
			id: `${prefix}-leg-${serial++}`,
			accountId: spec?.id ?? null,
			amount: randomAmount(spec),
			date: stamp(),
			createdAt: stamp(),
			source,
			countedUnits: counted,
			...links(source),
			// The trigger ignores both of these.
			currency: chance(0.3)
				? pick(["USD", "ARS", "JPY", "EUR"])
				: (spec?.currency ?? "ARS"),
			homeAmount: chance(0.4) ? amountOf(int(-9999, 9999), 2) : null,
		};
	}

	function mutate(row: LegRow): LegRow {
		const next: LegRow = { ...row };
		// A quarter of edits touch only what moves no money.
		if (chance(0.25)) {
			if (chance(0.6)) {
				const spec = specOf(row.accountId);
				next.countedUnits = spec
					? amountOf(int(0, spec.max * 10 ** spec.dp), spec.dp)
					: "0";
			} else {
				next.homeAmount = chance(0.5) ? null : amountOf(int(-9999, 9999), 2);
			}
			return next;
		}
		if (chance(0.5)) next.amount = randomAmount(specOf(row.accountId));
		if (chance(0.3)) next.date = stamp();
		if (chance(0.3)) next.createdAt = stamp();
		if (chance(0.25)) {
			const source = pick(SOURCES);
			next.source = source;
			Object.assign(next, links(source));
		}
		if (chance(0.25)) {
			next.accountId = chance(0.15) ? null : pick(specs).id;
		}
		// account_leg_source_check: these two always land in an account.
		if (
			(next.source === "INCOME" || next.source === "BALANCE_UPDATE") &&
			next.accountId === null
		) {
			next.accountId = pick(specs).id;
		}
		if (next.accountId === null) next.countedUnits = "0";
		return next;
	}

	function randomSnapshot(): LegSnapshot | null {
		const spec = pick(specs);
		const date = new Date(T0 + int(0, 14) * DAY);
		if (
			snapshots.some(
				(s) => s.accountId === spec.id && s.date.getTime() === date.getTime(),
			)
		) {
			return null;
		}
		const zero = chance(0.2);
		const balance = ties
			? amountOf(pick([0, 2, 4, 8, 16, 40, 80]) * 10 ** spec.dp, spec.dp)
			: zero
				? amountOf(0, spec.dp)
				: amountOf(
						(int(spec.type.startsWith("LIABILITY") ? 1 : -2, 10) *
							int(1, spec.max * 10 ** spec.dp)) /
							10,
						spec.dp,
					);
		const currency = chance(0.5) ? null : chance(0.1) ? "USD" : spec.currency;
		const usd =
			(currency ?? spec.currency) === "USD"
				? new Dec(balance).toDecimalPlaces(2).toFixed(2)
				: zero
					? amountOf(0, 2)
					: amountOf(ties ? int(1, 2000) : int(-300_000, 300_000), 2);
		return {
			id: `${prefix}-snap-${serial++}`,
			accountId: spec.id,
			date,
			balance,
			balanceInUSD: usd,
			currency,
			recordedAt: new Date(T0 + int(0, 14) * DAY + int(0, 23) * 3_600_000),
		};
	}

	/**
	 * Snapshots by date: the order the trigger's UPDATE visits them through the
	 * (accountId, date) unique index, which is the plan Postgres picks here
	 * (EXPLAIN shows an index scan). Another plan could visit them in another
	 * order; that only matters when a zero-balance snapshot is valued from one
	 * the same change already moved.
	 */
	function memoryState(): LegState {
		const sorted = [...snapshots].sort(
			(a, b) => a.date.getTime() - b.date.getTime(),
		);
		return { accounts, snapshots: sorted };
	}

	async function compare(step: number, what: string) {
		const db = await readDb();
		const diffs: string[] = [];
		for (const row of db.accounts) {
			const mem = accounts.get(row.id);
			if (!mem) continue;
			if (
				!new Dec(row.balance.toString()).eq(new Dec(mem.balance.toString()))
			) {
				diffs.push(
					`account ${row.name} balance db=${row.balance} mem=${mem.balance}`,
				);
			}
			if (
				!new Dec(row.countedUnits.toString()).eq(
					new Dec(mem.countedUnits.toString()),
				)
			) {
				diffs.push(
					`account ${row.name} countedUnits db=${row.countedUnits} mem=${mem.countedUnits}`,
				);
			}
		}
		if (db.snapshots.length !== snapshots.length) {
			diffs.push(
				`snapshot count db=${db.snapshots.length} mem=${snapshots.length}`,
			);
		}
		for (const row of db.snapshots) {
			const mem = snapshots.find((s) => s.id === row.id);
			if (!mem) {
				diffs.push(`snapshot ${row.id} missing in memory`);
				continue;
			}
			if (
				!new Dec(row.balance.toString()).eq(new Dec(mem.balance.toString()))
			) {
				diffs.push(
					`snapshot ${row.id} balance db=${row.balance} mem=${mem.balance}`,
				);
			}
			if (
				!new Dec(row.balanceInUSD.toString()).eq(
					new Dec(mem.balanceInUSD.toString()),
				)
			) {
				diffs.push(
					`snapshot ${row.id} balanceInUSD db=${row.balanceInUSD} mem=${mem.balanceInUSD}`,
				);
			}
		}
		if (diffs.length > 0) {
			throw new Error(
				`step ${step} (${what}) diverged, seed ${seed}:\n${diffs.join("\n")}\nlast operations:\n${log.slice(-6).join("\n")}`,
			);
		}
	}

	/** Runs one change through both, and checks they accept or refuse it alike. */
	async function both(
		step: number,
		what: string,
		change: Parameters<typeof applyLegs>[1][number],
		write: () => Promise<unknown>,
		commit: () => void,
	) {
		let memError: unknown = null;
		let next: LegState | null = null;
		try {
			next = applyLegs(memoryState(), [change]);
		} catch (error) {
			memError = error;
		}
		let dbError: unknown = null;
		try {
			await write();
		} catch (error) {
			dbError = error;
		}
		log.push(`${step} ${what}${dbError ? " (refused)" : ""}`);
		if (dbError || memError) {
			expect(
				{
					db: dbError && isOverflow(dbError),
					mem: memError instanceof RangeError,
				},
				`step ${step} ${what}: db ${String(dbError)} mem ${String(memError)}`,
			).toEqual({ db: true, mem: true });
			stats.overflow++;
			return;
		}
		if (!next) throw new Error("unreachable");
		for (const [id, account] of next.accounts) accounts.set(id, account);
		snapshots = [...next.snapshots];
		commit();
		await compare(step, what);
	}

	for (let step = 0; step < operations; step++) {
		const roll = random();
		const ids = [...legs.keys()];
		if (roll < 0.4 || ids.length === 0) {
			const row = randomLeg();
			stats.insert++;
			await both(
				step,
				`insert ${row.source} ${row.amount} acct ${row.accountId?.slice(prefix.length + 1)} counted ${row.countedUnits}`,
				{ op: "insert", leg: toLeg(row) },
				() => adminDb.accountLeg.create({ data: dbLeg(row) }),
				() => legs.set(row.id, row),
			);
		} else if (roll < 0.7) {
			const old = legs.get(pick(ids)) as LegRow;
			const row = mutate(old);
			stats.update++;
			await both(
				step,
				`update ${old.id} ${old.amount}->${row.amount}`,
				{ op: "update", old: toLeg(old), next: toLeg(row) },
				() =>
					adminDb.accountLeg.update({
						where: { id: old.id },
						data: dbLeg(row),
					}),
				() => legs.set(row.id, row),
			);
		} else if (roll < 0.82) {
			const old = legs.get(pick(ids)) as LegRow;
			stats.delete++;
			await both(
				step,
				`delete ${old.id}`,
				{ op: "delete", leg: toLeg(old) },
				() => adminDb.accountLeg.delete({ where: { id: old.id } }),
				() => legs.delete(old.id),
			);
		} else if (roll < 0.94) {
			const snap = randomSnapshot();
			if (!snap) continue;
			stats.snapshot++;
			await adminDb.assetSnapshot.create({
				data: {
					id: snap.id,
					userId,
					accountId: snap.accountId,
					date: snap.date,
					balance: snap.balance.toString(),
					balanceInUSD: snap.balanceInUSD.toString(),
					currency: snap.currency,
					recordedAt: snap.recordedAt,
				},
			});
			snapshots.push(snap);
			log.push(`${step} snapshot ${snap.id}`);
			await compare(step, "snapshot insert");
		} else {
			const spec = pick(specs);
			const balance = amountOf(int(0, spec.max * 10 ** spec.dp), spec.dp);
			stats.balance++;
			await fixtureDb.assetAccount.update({
				where: { id: spec.id },
				data: { balance },
			});
			accounts.set(spec.id, {
				...(accounts.get(spec.id) as LegAccount),
				balance,
			});
			log.push(`${step} set balance ${spec.id} ${balance}`);
			await compare(step, "balance write");
		}
	}
	return stats;
}

describe("pgDivide parity with Postgres numeric division", () => {
	it("gives the same digits as the database for the three shapes the trigger divides", async () => {
		const random = prng(SEED + 2);
		const int = (hi: number) => Math.floor(random() * hi);
		/** A random value with up to `digits` digits and `dp` decimals, any magnitude. */
		const value = (dp: number, digits: number) => {
			const length = 1 + int(digits);
			let text = String(1 + int(9));
			for (let i = 1; i < length; i++) text += String(int(10));
			return new Dec(text).div(new Dec(10).pow(dp)).toFixed(dp);
		};
		const cases = Array.from({ length: 1500 }, () => ({
			usd: value(2, 12),
			balance: value(8, 19),
			next: value(8, 19),
			rate: value(6, 18),
		}));
		const rows = await adminDb.$queryRaw<
			{ scaled: string; perUnit: string; inverse: string }[]
		>`
			SELECT
				(u::numeric(12,2) * n::numeric(19,8) / b::numeric(19,8))::text AS "scaled",
				(u::numeric(12,2) / b::numeric(19,8))::text AS "perUnit",
				(1 / r::numeric(18,6))::text AS "inverse"
			FROM unnest(
				${cases.map((c) => c.usd)}::text[],
				${cases.map((c) => c.balance)}::text[],
				${cases.map((c) => c.next)}::text[],
				${cases.map((c) => c.rate)}::text[]
			) AS t(u, b, n, r)`;
		rows.forEach((row, i) => {
			const c = cases[i] as (typeof cases)[number];
			const scaled = pgDivide(new Dec(c.usd).mul(c.next), c.balance, 2 + 8, 8);
			const perUnit = pgDivide(c.usd, c.balance, 2, 8);
			const inverse = pgDivide("1", c.rate, 0, 6);
			expect(
				{
					scaled: scaled.toFixed(),
					perUnit: perUnit.toFixed(),
					inverse: inverse.toFixed(),
				},
				`case ${i}: ${JSON.stringify(c)}`,
			).toEqual({
				scaled: new Dec(row.scaled).toFixed(),
				perUnit: new Dec(row.perUnit).toFixed(),
				inverse: new Dec(row.inverse).toFixed(),
			});
		});
	});
});

describe("applyLegs parity with the account_leg trigger", () => {
	it(`matches after each of ${OPERATIONS} random operations (seed ${SEED})`, async () => {
		const stats = await runSequence(SEED, OPERATIONS);
		// The run must have exercised every path, or it proves little.
		expect(stats.insert).toBeGreaterThan(100);
		expect(stats.update).toBeGreaterThan(60);
		expect(stats.delete).toBeGreaterThan(20);
		expect(stats.snapshot).toBeGreaterThan(10);
	}, 120_000);

	it(`matches on small whole amounts, where cents land on ties (seed ${SEED + 1})`, async () => {
		// Balances of 2, 4, 8, 16, 40, 80 against moves of up to 12 make
		// x.xx5 quotients common, so half-even and half-up part ways here.
		const stats = await runSequence(SEED + 1, OPERATIONS, true);
		expect(stats.insert).toBeGreaterThan(100);
		expect(stats.snapshot).toBeGreaterThan(10);
	}, 120_000);

	it("agrees with the database that a balance past numeric(19,8) is refused", async () => {
		await seedWorld();
		const id = `${prefix}-big`;
		await fixtureDb.assetAccount.create({
			data: {
				id,
				userId,
				name: "big",
				type: "CASH",
				currency: "USD",
				balance: "99999999999",
			},
		});
		const leg = {
			accountId: id,
			amount: "2",
			date: new Date(T0),
			createdAt: new Date(T0),
			source: "TRANSFER" as const,
			countedUnits: "0",
		};
		expect(() =>
			applyLegs(
				{
					accounts: new Map([
						[
							id,
							{
								type: "CASH",
								currency: "USD",
								balance: "99999999999",
								countedUnits: "0",
								exchangeRate: null,
							},
						],
					]),
					snapshots: [],
				},
				[{ op: "insert", leg }],
			),
		).toThrow(RangeError);
		await expect(
			adminDb.accountLeg.create({
				data: {
					userId,
					accountId: id,
					currency: "USD",
					amount: "2",
					date: leg.date,
					source: "TRANSFER",
					transferId,
					countedUnits: "0",
				},
			}),
		).rejects.toThrow();
		const after = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(after.balance.toString()).toBe("99999999999");
	});
});
