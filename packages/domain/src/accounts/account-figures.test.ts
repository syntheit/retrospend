/**
 * The account figures' compute over hand-derived rows. Home ARS unless said:
 * Blue 1,468, Official 1,412, MEP 1,449 per USD, BTC USD 60,000. The two
 * loaders are held to each other on real Postgres
 * (src/server/services/accounts/account-figures.pg.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
	type AccountRow,
	accountBalancesFrom,
	accountsLedgerFromRows,
	type LegRow,
	netWorthChangeFrom,
	netWorthFrom,
	notTrackedFrom,
	notTrackedUnitsOf,
	type OwedReading,
	type SnapshotRow,
} from "./account-figures";
import { type PickRateRow, ratePickFromRows } from "./valuation";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-15T12:00:00Z");

const RATES: PickRateRow[] = [
	...(
		[
			["blue", 1468],
			["official", 1412],
			["mep", 1449],
		] as const
	).map(([type, rate]) => ({
		currency: "ARS",
		type,
		rate,
		date: at("2026-10-14T00:00:00Z"),
	})),
	{
		currency: "BTC",
		type: "crypto",
		rate: 60000,
		date: at("2026-10-14T00:00:00Z"),
	},
];
const pick = ratePickFromRows(RATES);

let n = 0;
const account = (o: Partial<AccountRow> & Pick<AccountRow, "balance">) => ({
	id: `a${++n}`,
	type: "CASH" as const,
	currency: "ARS",
	exchangeRate: null,
	exchangeRateType: null,
	closedAt: null,
	createdAt: at("2026-10-01T00:00:00Z"),
	...o,
});
const NO_PEOPLE: OwedReading = { owedToYou: 0, youOwe: 0 };
const worth = (
	accounts: AccountRow[],
	owed: OwedReading = NO_PEOPLE,
	notTracked: { currency: string; units: string }[] = [],
	home = "ARS",
) => netWorthFrom({ home, accounts, notTracked, pick, owed }, NOW);

describe("netWorthFrom", () => {
	it("open accounts at their rate type plus Not tracked: 656,000 + 4,100 x 1,412 + 50 x 1,468", () => {
		const r = worth(
			[
				account({ balance: "656000" }),
				account({
					type: "INVESTMENT",
					currency: "USD",
					balance: "4100",
					exchangeRateType: "official",
				}),
			],
			NO_PEOPLE,
			[{ currency: "USD", units: "50" }],
		);
		// 656,000 + 5,789,200 + 73,400
		expect(r).toEqual({
			value: { currency: "ARS", minor: 651_860_000 },
			missingRates: [],
		});
	});

	it("a liability counts against you, in its own currency at its own rate type", () => {
		const r = worth([
			account({
				type: "LIABILITY_LOAN",
				currency: "USD",
				balance: "1000",
				exchangeRateType: "mep",
			}),
		]);
		expect(r.value?.minor).toBe(-144_900_000);
	});

	it("a crypto account is USD per coin times the home rate: 0.6 x 60,000 x 1,468", () => {
		const r = worth([
			account({ type: "CRYPTO", currency: "BTC", balance: "0.6" }),
		]);
		expect(r.value?.minor).toBe(5_284_800_000);
	});

	it("a closed account counts 0", () => {
		const r = worth([
			account({ balance: "100" }),
			account({ balance: "5000", closedAt: at("2026-10-10T00:00:00Z") }),
		]);
		expect(r.value?.minor).toBe(10_000);
	});

	it("Owed to you is added and You owe taken away, never netted first", () => {
		const r = worth([account({ balance: "100" })], {
			owedToYou: 3_000_000,
			youOwe: 1_200_000,
		});
		expect(r.value?.minor).toBe(10_000 + 3_000_000 - 1_200_000);
	});

	it("people with no rate keep net worth out and name their currencies", () => {
		const r = worth([account({ balance: "100" })], {
			missingRates: ["BRL"],
		});
		expect(r).toEqual({ value: null, missingRates: ["BRL"] });
	});

	it("an account with no rate anywhere is named, not valued at 1", () => {
		const r = worth(
			[account({ currency: "BRL", balance: "1000" })],
			NO_PEOPLE,
			[{ currency: "EUR", units: "0" }],
		);
		expect(r.value).toBeNull();
		expect(r.missingRates).toEqual(["BRL", "EUR"]);
	});

	it("no table rate falls back to the account's stored rate: 1,000 / 5.4 x 1,468", () => {
		const r = worth([
			account({ currency: "BRL", balance: "1000", exchangeRate: "5.4" }),
		]);
		// 271,851.85185...
		expect(r.value?.minor).toBe(27_185_185);
	});

	it("another home currency: ARS 1,000,000 at Official is USD 708.22 at home USD", () => {
		const r = worth(
			[account({ balance: "1000000", exchangeRateType: "official" })],
			NO_PEOPLE,
			[],
			"USD",
		);
		expect(r.value).toEqual({ currency: "USD", minor: 70_822 });
	});
});

describe("accountBalancesFrom", () => {
	const rows = [
		account({ id: "wallet", balance: "656000" }),
		account({
			id: "card",
			type: "LIABILITY_CREDIT_CARD",
			balance: "150000",
		}),
		account({ id: "wise", currency: "USD", balance: "4100.5" }),
		account({
			id: "old",
			balance: "5000",
			closedAt: at("2026-10-10T00:00:00Z"),
		}),
	];

	it("sums open accounts per currency, liabilities against you", () => {
		expect(accountBalancesFrom(rows)).toEqual([
			{ currency: "ARS", minor: 50_600_000 },
			{ currency: "USD", minor: 410_050 },
		]);
	});

	it("one account is narrowed to, closed or not", () => {
		expect(accountBalancesFrom(rows, "old")).toEqual([
			{ currency: "ARS", minor: 500_000 },
		]);
		expect(accountBalancesFrom(rows, "card")).toEqual([
			{ currency: "ARS", minor: -15_000_000 },
		]);
	});
});

describe("Not tracked", () => {
	const legs = [
		{ accountId: null, currency: "USD", amount: "50.25" },
		{ accountId: null, currency: "USD", amount: "-0.25" },
		{ accountId: "a1", currency: "USD", amount: "999" },
		{ accountId: null, currency: "EUR", amount: "20" },
		{ accountId: null, currency: "EUR", amount: "-20" },
	];

	it("sums the legs with no account per currency and keeps a currency that nets to 0", () => {
		expect(notTrackedUnitsOf(legs)).toEqual([
			{ currency: "USD", units: "50" },
			{ currency: "EUR", units: "0" },
		]);
	});

	it("the figure leaves out a currency that nets to nothing", () => {
		expect(notTrackedFrom(notTrackedUnitsOf(legs))).toEqual([
			{ currency: "USD", minor: 5_000 },
		]);
	});
});

describe("accountsLedgerFromRows", () => {
	const snap = (
		accountId: string,
		date: string,
		recordedAt: string,
		balance: string,
	): SnapshotRow => ({
		accountId,
		date: at(date),
		recordedAt: at(recordedAt),
		balance,
		currency: "ARS",
		exchangeRateType: null,
	});
	const legRow = (
		id: string,
		accountId: string | null,
		amount: string,
		source: LegRow["source"],
		day: string,
		createdAt: string,
	): LegRow => ({
		id,
		accountId,
		currency: "ARS",
		date: at(`${day}T00:00:00Z`),
		createdAt: at(createdAt),
		amount,
		source,
		homeAmount: null,
		homeCurrency: null,
	});
	const accounts = [
		account({
			id: "w",
			balance: "1250",
			createdAt: at("2026-10-01T00:00:00Z"),
		}),
		account({ id: "x", balance: "10", createdAt: at("2026-10-01T00:00:01Z") }),
	];
	const snapshots = [
		snap("w", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "1000"),
		snap("x", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "10"),
	];
	const legs = [
		legRow("l1", "w", "200", "INCOME", "2026-10-10", "2026-10-10T09:00:00Z"),
		legRow("l2", "w", "-100", "FEE", "2026-10-10", "2026-10-10T09:00:00Z"),
		legRow("l3", "w", "150", "TRANSFER", "2026-10-12", "2026-10-12T09:00:00Z"),
		legRow("l4", null, "5", "TRANSFER", "2026-10-12", "2026-10-12T09:00:00Z"),
	];
	const build = (a: AccountRow[], s: SnapshotRow[], l: LegRow[]) =>
		accountsLedgerFromRows({
			home: "ARS",
			accounts: a,
			snapshots: s,
			legs: l,
			rateSwitches: [],
			pick,
		});

	it("rows in any order give one ledger", () => {
		const ordered = build(accounts, snapshots, legs);
		const shuffled = build([...accounts].reverse(), [...snapshots].reverse(), [
			legs[3],
			legs[1],
			legs[2],
			legs[0],
		] as LegRow[]);
		expect(shuffled).toEqual({ ...ordered, pick: shuffled.pick });
		expect(ordered.histories.map((h) => h.account.id)).toEqual(["w", "x"]);
		expect(ordered.histories[0]?.legs.map((l) => l.id)).toEqual([
			"l1",
			"l2",
			"l3",
		]);
		expect(ordered.notTracked.map((t) => t.currency)).toEqual(["ARS"]);
	});

	it("the change since Sep 15 is the whole worth, split by what wrote it: 1,250 = 1,000 + 200 - 100 + 150, plus 10 and Not tracked 5", () => {
		const change = netWorthChangeFrom(build(accounts, snapshots, legs), NOW);
		expect(change).toEqual({
			currency: "ARS",
			total: 126_500,
			parts: {
				opened: 101_000,
				income: 20_000,
				spending: -10_000,
				exchange: 15_500,
				notLogged: 0,
				revaluation: 0,
				closed: 0,
			},
		});
	});
});

describe("ratePickFromRows", () => {
	it("USD is 1 and a currency with no rows has no rate", () => {
		expect(pick("USD", NOW)?.rate).toBe(1);
		expect(pick("BRL", NOW)).toBeNull();
	});

	it("sees every row of a currency: an old rate type behind many newer ones is still there", () => {
		const rows: PickRateRow[] = [
			{
				currency: "CLP",
				type: "mep",
				rate: 900,
				date: at("2026-09-01T00:00:00Z"),
			},
			...Array.from({ length: 25 }, (_, i) => ({
				currency: "CLP",
				type: "official",
				rate: 950 + i,
				date: at(`2026-09-${String(2 + i).padStart(2, "0")}T00:00:00Z`),
			})),
		];
		expect(ratePickFromRows(rows)("CLP", NOW, "mep")?.rate).toBe(900);
	});
});
