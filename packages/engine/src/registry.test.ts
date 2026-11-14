/**
 * The device figure registry on a hand-built ledger. Every expected value is
 * derived in the comments from the rows below, never copied from the output.
 *
 * The user: home currency ARS, Buenos Aires (UTC-3), fiscal month from the
 * 1st. Rates in `rates` (units per USD), both dated 2026-10-10:
 *   ARS blue 1,500 and ARS official 1,000; JPY official 150.
 * defaultRateTypes says ARS official, which no figure reads: pickBestRate
 * ranks blue first when no type is asked for, so a glance rate is blue 1,500.
 * "Now" is 2026-10-15 12:00 in Buenos Aires (15:00 UTC), so the month is
 * 2026-10-01T03:00Z to 2026-11-01T02:59:59.999Z.
 */
import { FigureNarrowingError } from "@retrospend/domain/figures/narrowing";
import {
	FigureError,
	FigurePass,
	type FigureReading,
	readFiguresIn,
} from "@retrospend/domain/figures/registry";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "./errors";
import { fixtureRow } from "./fixtures";
import { MemoryStore } from "./memory-store";
import { type Reader, TABLE_NAMES, type TableName, type TableRows } from "./port";
import { DEVICE_FIGURE_IDS, deviceFigures, serverOnlyReason } from "./registry";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-15T15:00:00Z");
const scope = { userId: "u1" };

const expense = (id: string, o: Partial<TableRows["expenses"]>) => ({
	...fixtureRow("expenses", id),
	homeCurrency: null,
	homeAmount: null,
	...o,
});
const account = (id: string, o: Partial<TableRows["accounts"]>) => ({
	...fixtureRow("accounts", id),
	exchangeRate: null,
	exchangeRateType: null,
	...o,
});
const rate = (
	currency: string,
	type: string,
	value: string,
): TableRows["rates"] => ({
	id: `${currency}:${type}`,
	currency,
	type,
	rate: value,
	date: at("2026-10-10T00:00:00Z"),
});

/** One list per table: the typed rows a test seeds a store with. */
type Rows = { [T in TableName]: TableRows[T][] };

const rows = (): Rows => ({
	budgetMovements: [],
	categories: [],
	// Alice is owed ARS 5,000.00 and owes ARS 2,000.00, in her home currency.
	owed: [{ id: "owed", currency: "ARS", owedToYou: 500_000, youOwe: 200_000 }],
	rateSwitches: [],
	rateSync: [],
	snapshots: [],
	settings: [
		{
			...fixtureRow("settings", "user"),
			defaultRateTypes: { ARS: "official" },
		},
	],
	rates: [
		rate("ARS", "blue", "1500"),
		rate("ARS", "official", "1000"),
		rate("JPY", "official", "150"),
	],
	expenses: [
		// Booked at home when saved: counts as entered, 30,000 ARS.
		expense("e1", {
			currency: "ARS",
			amount: "30000",
			amountInUSD: "20",
			homeCurrency: "ARS",
			homeAmount: "30000",
			date: at("2026-10-05T15:00:00Z"),
		}),
		expense("e2", {
			currency: "USD",
			amount: "10",
			amountInUSD: "10",
			date: at("2026-10-06T15:00:00Z"),
		}),
		expense("e3", {
			currency: "JPY",
			amount: "3000",
			amountInUSD: "20",
			date: at("2026-10-07T15:00:00Z"),
		}),
		expense("e4", {
			currency: "KWD",
			amount: "3",
			amountInUSD: "10",
			date: at("2026-10-07T16:00:00Z"),
		}),
		// 23:30 on October 31 in Buenos Aires: still October.
		expense("e5", {
			currency: "ARS",
			amount: "100",
			amountInUSD: "0.07",
			homeCurrency: "ARS",
			homeAmount: "100",
			date: at("2026-11-01T02:30:00Z"),
		}),
		// 00:00 on November 1 in Buenos Aires: November, not this month.
		expense("e6", {
			currency: "ARS",
			amount: "7",
			amountInUSD: "0.005",
			homeCurrency: "ARS",
			homeAmount: "7",
			date: at("2026-11-01T03:00:00Z"),
		}),
		// 23:59 on September 30 in Buenos Aires: last period.
		expense("e7", {
			currency: "ARS",
			amount: "5",
			amountInUSD: "0.003",
			homeCurrency: "ARS",
			homeAmount: "5",
			date: at("2026-10-01T02:59:00Z"),
		}),
		// Money in typed as income: Money in, never spending.
		expense("in1", {
			currency: "ARS",
			amount: "2000",
			amountInUSD: "1.33",
			direction: "IN",
			inType: "INCOME",
			homeCurrency: "ARS",
			homeAmount: "2000",
			date: at("2026-10-02T15:00:00Z"),
		}),
	],
	shares: [
		// No captured rate: priced at the table's JPY 150 on its own date.
		{
			...fixtureRow("shares", "s1"),
			currency: "JPY",
			shareAmount: "1500",
			exchangeRate: null,
			date: at("2026-10-08T15:00:00Z"),
		},
	],
	accounts: [
		account("a1", {
			currency: "ARS",
			balance: "50000",
			createdAt: at("2026-01-01T00:00:00Z"),
		}),
		account("a2", {
			currency: "USD",
			balance: "200",
			exchangeRateType: "official",
			createdAt: at("2026-01-01T00:00:00Z"),
		}),
		account("a3", {
			currency: "USD",
			balance: "999",
			closedAt: at("2026-02-01T00:00:00Z"),
			createdAt: at("2026-01-01T00:00:00Z"),
		}),
	],
	legs: [
		{
			...fixtureRow("legs", "l1"),
			accountId: "a1",
			currency: "ARS",
			amount: "1000",
			source: "INCOME",
			homeAmount: "1000",
			homeCurrency: "ARS",
			date: at("2026-10-10T00:00:00Z"),
			createdAt: at("2026-10-10T08:00:00Z"),
		},
		{
			...fixtureRow("legs", "l2"),
			accountId: null,
			currency: "ARS",
			amount: "-1500.50",
			source: "FEE",
			homeAmount: null,
			homeCurrency: null,
			date: at("2026-08-01T12:00:00Z"),
			createdAt: at("2026-08-01T12:00:00Z"),
		},
	],
	recurringTemplates: [
		{
			...fixtureRow("recurringTemplates", "rent"),
			name: "Rent",
			amount: "300000",
			currency: "ARS",
		},
		{
			...fixtureRow("recurringTemplates", "tv"),
			name: "TV",
			amount: "10",
			currency: "USD",
		},
	],
});

const store = (o: Partial<Rows> = {}) =>
	new MemoryStore({ rows: { ...rows(), ...o } });

function read(
	reader: Reader,
	ids: readonly string[],
	opts: {
		clock?: () => Date;
		narrow?: Record<string, string>;
	} = {},
) {
	const registry = deviceFigures({ clock: opts.clock ?? (() => NOW) });
	const pass = new FigurePass();
	return readFiguresIn(
		reader,
		ids.map((id) => registry.get(id)),
		{ ...scope, ...opts.narrow },
		pass,
	).then((m) => ({ m, pass }));
}

const one = async (
	id: string,
	opts?: Parameters<typeof read>[2],
	s: Reader = store(),
): Promise<FigureReading> => (await read(s, [id], opts)).m.get(id) ?? null;

describe("device figure registry", () => {
	it("registers exactly DEVICE_FIGURE_IDS and none sets inEveryPreview", () => {
		const registry = deviceFigures();
		expect([...registry.ids].sort()).toEqual([...DEVICE_FIGURE_IDS].sort());
		expect(DEVICE_FIGURE_IDS).toHaveLength(23);
		expect(registry.inEveryPreview).toEqual([]);
	});

	it("names a reason for the server figures it leaves out", () => {
		expect(serverOnlyReason("entry.amount")).toMatch(/P13b/);
		expect(serverOnlyReason("owed.owedToYou")).toBeDefined();
		expect(serverOnlyReason("spent")).toBeUndefined();
	});

	describe("figure spent", () => {
		// October in ARS: e1 30,000 + e5 100 = 30,100.00 (e6 is November, e7 September).
		// USD e2 10.00; JPY e3 3,000 + the share 1,500 = 4,500 (no decimals);
		// KWD e4 3.000 (three decimals). Never converted, sorted by code.
		it("lists spending per original currency in minor units", async () => {
			expect(await one("spent")).toEqual([
				{ minor: 3_010_000, currency: "ARS" },
				{ minor: 4_500, currency: "JPY" },
				{ minor: 3_000, currency: "KWD" },
				{ minor: 1_000, currency: "USD" },
			]);
		});

		// A registry built once keeps reading the clock: November from
		// 2026-11-01T03:00Z holds only e6, ARS 7.00.
		it("rereads the clock on every pass, never one captured at construction", async () => {
			let now = NOW;
			const registry = deviceFigures({ clock: () => now });
			const s = store();
			const spent = () =>
				readFiguresIn(s, [registry.get("spent")], scope).then((m) =>
					m.get("spent"),
				);
			expect((await spent())?.[0]).toEqual({
				minor: 3_010_000,
				currency: "ARS",
			});
			now = at("2026-11-15T15:00:00Z");
			expect(await spent()).toEqual([{ minor: 700, currency: "ARS" }]);
		});
	});

	describe("figure glance.spent", () => {
		// Home ARS at blue 1,500, the whole of October, by the totals rule:
		//   e1 30,000 and e5 100 booked ARS, as entered       30,100
		//   e2 10 USD, e3 20 USD, e4 10 USD stored values     40 USD x 1,500 = 60,000
		//   the JPY share 1,500 at the table's 150            1,500 / 150 x 1,500 = 15,000
		// = 105,100.00 ARS.
		it("totals the month at blue, pricing a share with no captured rate from the table", async () => {
			expect(await one("glance.spent")).toEqual([
				{ minor: 10_510_000, currency: "ARS" },
			]);
		});

		// September: e7 ARS 5.00 booked at home.
		it("glance.spentLast is last period's total", async () => {
			expect(await one("glance.spentLast")).toEqual([
				{ minor: 500, currency: "ARS" },
			]);
		});

		// Up to day 15 of September: e7 is on the 30th, so nothing yet.
		it("glance.spentLastToDate stops at the same day", async () => {
			expect(await one("glance.spentLastToDate")).toEqual([
				{ minor: 0, currency: "ARS" },
			]);
		});

		it("glance.moneyIn is October's income", async () => {
			// in1 ARS 2,000.00.
			expect(await one("glance.moneyIn")).toEqual([
				{ minor: 200_000, currency: "ARS" },
			]);
		});

		// A share in XQZ with no captured rate and no table rate cannot be
		// priced: the month reads unavailable and names XQZ, while `spent` still
		// lists it in its own currency and last period is untouched.
		it("reads unavailable, never at 1, when a share has no rate at all", async () => {
			const s = store({
				shares: [
					...rows().shares,
					{
						...fixtureRow("shares", "s2"),
						currency: "XQZ",
						shareAmount: "12.34",
						exchangeRate: null,
						date: at("2026-10-09T15:00:00Z"),
					},
				],
			});
			const { m, pass } = await read(s, [
				"glance.spent",
				"glance.spentLast",
				"spent",
			]);
			expect(m.get("glance.spent")).toBeNull();
			expect(pass.missingRates("glance.spent")).toEqual(["XQZ"]);
			expect(m.get("glance.spentLast")).toEqual([
				{ minor: 500, currency: "ARS" },
			]);
			expect(m.get("spent")).toContainEqual({ minor: 1_234, currency: "XQZ" });
		});
	});

	describe("figure recurring.amount", () => {
		it("is one template's amount in its own currency", async () => {
			expect(
				await one("recurring.amount", { narrow: { recurringId: "tv" } }),
			).toEqual([{ minor: 1_000, currency: "USD" }]);
		});

		it("is empty for a template that is not there", async () => {
			expect(
				await one("recurring.amount", { narrow: { recurringId: "nope" } }),
			).toEqual([]);
		});

		it("throws the shared narrowing error without a recurringId", async () => {
			await expect(one("recurring.amount")).rejects.toBeInstanceOf(
				FigureNarrowingError,
			);
		});
	});

	describe("figure recurring.cost.out.month", () => {
		// Rent 300,000 ARS + TV 10 USD at blue 1,500 = 15,000 ARS: 315,000.00 a month.
		it("prices each template at the best rate and adds them", async () => {
			expect(await one("recurring.cost.out.month")).toEqual([
				{ minor: 31_500_000, currency: "ARS" },
			]);
		});

		it("scales a month to a quarter and a year", async () => {
			expect(await one("recurring.cost.out.quarter")).toEqual([
				{ minor: 94_500_000, currency: "ARS" },
			]);
			expect(await one("recurring.cost.out.year")).toEqual([
				{ minor: 378_000_000, currency: "ARS" },
			]);
		});

		it("is empty when no active template brings money in", async () => {
			expect(await one("recurring.cost.in.month")).toEqual([]);
		});

		it("reads unavailable and names the currency when a template has no rate", async () => {
			const s = store({
				recurringTemplates: [
					...rows().recurringTemplates,
					{
						...fixtureRow("recurringTemplates", "xq"),
						name: "XQ",
						amount: "5",
						currency: "XQZ",
					},
				],
			});
			const { m, pass } = await read(s, ["recurring.cost.out.month"]);
			expect(m.get("recurring.cost.out.month")).toBeNull();
			expect(pass.missingRates("recurring.cost.out.month")).toEqual(["XQZ"]);
		});
	});

	describe("figure netWorth", () => {
		// Open accounts: a1 50,000 ARS as is; a2 200 USD at the official 1,000
		// (its rate type) = 200,000; a3 is closed. Not tracked: -1,500.50.
		// 50,000 + 200,000 - 1,500.50 = 248,499.50, 24,849,950 minor, plus
		// owed to you 500,000 minus you owe 200,000 = 25,149,950.
		it("adds accounts at their rate type, Not tracked and the owed reading", async () => {
			expect(await one("netWorth")).toEqual([
				{ minor: 25_149_950, currency: "ARS" },
			]);
		});

		it("names the currencies of an unavailable owed reading", async () => {
			const s = store({ owed: [{ id: "owed", missingRates: ["BRL"] }] });
			const { m, pass } = await read(s, ["netWorth"]);
			expect(m.get("netWorth")).toBeNull();
			expect(pass.missingRates("netWorth")).toEqual(["BRL"]);
		});

		// Owed to you 0 and You owe 0 are a reading too: 248,499.50 alone.
		it("adds nothing for totals of zero, and reads them from the store like any table", async () => {
			const s = store({
				owed: [{ id: "owed", currency: "ARS", owedToYou: 0, youOwe: 0 }],
			});
			expect(await one("netWorth", undefined, s)).toEqual([
				{ minor: 24_849_950, currency: "ARS" },
			]);
		});

		it("throws when shares were never pulled, instead of reading owed as 0", async () => {
			const error = await one("netWorth", undefined, store({ owed: [] })).catch(
				(e) => e,
			);
			expect(error).toBeInstanceOf(FigureError);
			expect((error as FigureError).cause).toBeInstanceOf(NotFoundError);
		});

		it("throws when the totals are in another currency than the home currency", async () => {
			const s = store({
				owed: [{ id: "owed", currency: "USD", owedToYou: 500, youOwe: 0 }],
			});
			const error = await one("netWorth", undefined, s).catch((e) => e);
			expect(error).toBeInstanceOf(FigureError);
			expect((error as FigureError).cause).toBeInstanceOf(NotFoundError);
		});

		it("reads unavailable when an account's currency has no rate", async () => {
			const s = store({
				accounts: [
					...rows().accounts,
					account("a4", { currency: "XQZ", balance: "10" }),
				],
				// An income leg in XQZ inside the span, with no booked home value.
				legs: [
					...rows().legs,
					{
						...fixtureRow("legs", "l3"),
						accountId: "a4",
						currency: "XQZ",
						amount: "10",
						source: "INCOME",
						homeAmount: null,
						homeCurrency: null,
						date: at("2026-10-12T00:00:00Z"),
						createdAt: at("2026-10-12T08:00:00Z"),
					},
				],
			});
			const { m, pass } = await read(
				s,
				["netWorth", "netWorthChange.total"],
				{},
			);
			expect(m.get("netWorth")).toBeNull();
			expect(pass.missingRates("netWorth")).toEqual(["XQZ"]);
			expect(m.get("netWorthChange.total")).toBeNull();
		});
	});

	describe("figure netWorthChange.total", () => {
		// The last 30 days to today. A ledger with no balance update starts from
		// its legs: a1 holds nothing before the 10th and 1,000.00 after l1, an
		// income, so it moved 100,000 minor, all of it explained as income. a2
		// has no legs or updates, so it is 0 at both ends, and Not tracked's only
		// leg is in August, before the span.
		it("explains the span by its parts, which add up to the total", async () => {
			const parts = [
				"income",
				"spending",
				"exchange",
				"notLogged",
				"revaluation",
				"opened",
				"closed",
			];
			const { m } = await read(store(), [
				"netWorthChange.total",
				...parts.map((p) => `netWorthChange.${p}`),
			]);
			expect(m.get("netWorthChange.total")).toEqual([
				{ minor: 100_000, currency: "ARS" },
			]);
			expect(m.get("netWorthChange.income")).toEqual([
				{ minor: 100_000, currency: "ARS" },
			]);
			for (const p of parts.filter((x) => x !== "income"))
				expect(m.get(`netWorthChange.${p}`)).toEqual([
					{ minor: 0, currency: "ARS" },
				]);
		});
	});

	describe("figure accounts.balance", () => {
		// Open accounts per currency: ARS 50,000.00 and USD 200.00; a3 is closed.
		it("lists what open accounts hold per currency", async () => {
			expect(await one("accounts.balance")).toEqual([
				{ minor: 5_000_000, currency: "ARS" },
				{ minor: 20_000, currency: "USD" },
			]);
		});

		it("narrows to one account, open or closed", async () => {
			expect(
				await one("accounts.balance", { narrow: { accountId: "a3" } }),
			).toEqual([{ minor: 99_900, currency: "USD" }]);
		});
	});

	describe("figure notTracked", () => {
		it("is the cash side of moves with no account", async () => {
			// l2: -1,500.50 ARS.
			expect(await one("notTracked")).toEqual([
				{ minor: -150_050, currency: "ARS" },
			]);
		});
	});

	describe("one read pass", () => {
		/** Ids that need no narrowing; recurring.amount is read on its own below. */
		const IDS = DEVICE_FIGURE_IDS.filter((id) => id !== "recurring.amount");

		/** A ledger where a share, a template and an account all miss a rate, so every missing-rate path runs. */
		const missingEverywhere = () =>
			store({
				shares: [
					...rows().shares,
					{
						...fixtureRow("shares", "s2"),
						currency: "XQZ",
						shareAmount: "12.34",
						exchangeRate: null,
						date: at("2026-10-09T15:00:00Z"),
					},
				],
				recurringTemplates: [
					...rows().recurringTemplates,
					{
						...fixtureRow("recurringTemplates", "xq"),
						name: "XQ",
						amount: "5",
						currency: "XQZ",
					},
				],
				accounts: [
					...rows().accounts,
					account("a4", { currency: "XQZ", balance: "10" }),
				],
			});

		/** A reader that counts how many times each table is listed. */
		function counting(reader: Reader) {
			const lists = new Map<TableName, number>();
			const counted: Reader = {
				get: (table, id) => reader.get(table, id),
				list: (table) => {
					lists.set(table, (lists.get(table) ?? 0) + 1);
					return reader.list(table);
				},
			};
			return { counted, lists };
		}

		it("reads every figure as one pass per figure does, missing rates included, and lists each table once", async () => {
			const s = missingEverywhere();
			const before = Object.fromEntries(
				TABLE_NAMES.map((t) => [t, s.list(t)]),
			);
			const { counted, lists } = counting(s);
			const together = await read(counted, IDS);
			for (const id of IDS) {
				const alone = await read(s, [id]);
				expect(together.m.get(id), id).toEqual(alone.m.get(id));
				expect(together.pass.missingRates(id), `${id} missing`).toEqual(
					alone.pass.missingRates(id),
				);
			}
			// The ledger does miss rates, so the comparison above is not vacuous.
			expect(together.pass.missingRates("glance.spent")).toEqual(["XQZ"]);
			expect(together.pass.missingRates("netWorth")).toEqual(["XQZ"]);
			expect(together.pass.missingRates("recurring.cost.out.month")).toEqual([
				"XQZ",
			]);
			expect(Math.max(...lists.values())).toBe(1);
			expect(lists.get("rates")).toBe(1);
			expect(
				Object.fromEntries(TABLE_NAMES.map((t) => [t, s.list(t)])),
			).toEqual(before);
		});

		it("reads one template's amount as a pass of its own does", async () => {
			const s = missingEverywhere();
			const narrow = { recurringId: "xq" };
			const { counted } = counting(s);
			const withOthers = await read(counted, ["recurring.amount", "spent"], {
				narrow,
			});
			const alone = await read(s, ["recurring.amount"], { narrow });
			expect(withOthers.m.get("recurring.amount")).toEqual(
				alone.m.get("recurring.amount"),
			);
		});

		it("a pass handed to a second reader reads that reader's rows, not the first one's", async () => {
			const first = store();
			const second = store({
				expenses: [
					...rows().expenses,
					expense("extra", {
						currency: "USD",
						amount: "77",
						amountInUSD: "77",
						date: at("2026-10-08T15:00:00Z"),
					}),
				],
			});
			const registry = deviceFigures({ clock: () => NOW });
			const definitions = [registry.get("spent")];
			const pass = new FigurePass();
			await readFiguresIn(first, definitions, scope, pass);
			const shared = await readFiguresIn(second, definitions, scope, pass);
			const fresh = await readFiguresIn(second, definitions, scope);
			expect(shared.get("spent")).toEqual(fresh.get("spent"));
			expect(fresh.get("spent")).toContainEqual({
				minor: 8_700,
				currency: "USD",
			});
		});
	});

	describe("without a settings row", () => {
		it("throws instead of falling back to USD", async () => {
			const s = store({ settings: [] });
			const error = await one("spent", undefined, s).catch((e) => e);
			expect(error).toBeInstanceOf(FigureError);
			expect((error as FigureError).cause).toBeInstanceOf(NotFoundError);
		});
	});
});
