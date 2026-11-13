import { MissingRateError } from "@retrospend/domain/money";
import {
	pickBestRate,
	rateLookup,
	rateRowsByCurrency,
} from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import {
	InvalidInputError,
	LocalDb,
	MemoryStore,
	type Reader,
	SETTINGS_ID,
	TABLE_NAMES,
	type TableName,
} from "./index";
import {
	applyDailyTable,
	type DailyRateRow,
	type DailyTable,
	RateHistoryStore,
	ratesAsOf,
} from "./rates";
import { repos } from "./repos";

const D = "2026-03-05T00:00:00.000Z";
const WHEN = new Date("2026-03-05T15:00:00Z");
const row = (
	currency: string,
	type: string,
	unitsPerUsd: string,
	date = D,
): DailyRateRow => ({
	id: `${currency}-${type}`,
	currency,
	type,
	date,
	unitsPerUsd,
});

/** What GET /rates/daily answers for an ARS-home ledger: no USD row, no BRL row. */
const daily = (rates: DailyRateRow[], asOf: string | null = D): DailyTable => ({
	asOf,
	rates,
});
const ARS_TABLE = daily([
	row("ARS", "blue", "1545"),
	row("ARS", "official", "1000"),
	row("EUR", "official", "0.8"),
]);

async function arsStore() {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		tx.put("settings", {
			id: SETTINGS_ID,
			homeCurrency: "ARS",
			timeZone: "America/Argentina/Buenos_Aires",
			startDay: 1,
			hiddenProjectIds: [],
		});
		applyDailyTable(tx, ARS_TABLE);
	});
	return store;
}

const book = (
	store: MemoryStore,
	over: { id?: string; currency: string; amount: string; rateType?: string },
) =>
	new LocalDb(store).write(
		EXPENSE_CREATE,
		createExpense({ id: "e1", title: "Lunch", date: WHEN, ...over }),
	);

describe("applyDailyTable", () => {
	it("replaces the rates table and stores asOf in one commit", async () => {
		const store = await arsStore();
		expect(store.list("rates").map((r) => r.id)).toEqual([
			"ARS-blue",
			"ARS-official",
			"EUR-official",
		]);
		expect(store.get("rates", "ARS-blue")).toEqual({
			id: "ARS-blue",
			currency: "ARS",
			type: "blue",
			rate: "1545",
			date: new Date(D),
		});
		expect(ratesAsOf(store)).toBe(D);

		const later = "2026-03-06T09:05:00.000Z";
		await store.transaction((tx) =>
			applyDailyTable(
				tx,
				daily([row("ARS", "blue", "1600", later)], later),
			),
		);
		// official and EUR are gone: nothing is kept from the old table.
		expect(store.list("rates")).toEqual([
			{
				id: "ARS-blue",
				currency: "ARS",
				type: "blue",
				rate: "1600",
				date: new Date(later),
			},
		]);
		expect(ratesAsOf(store)).toBe(later);
	});

	it("applies nothing when the transaction rolls back", async () => {
		const store = await arsStore();
		await expect(
			store.transaction((tx) => {
				applyDailyTable(tx, daily([row("ARS", "blue", "1")], "x"));
				throw new Error("disk full");
			}),
		).rejects.toThrow("disk full");
		expect(store.get("rates", "ARS-blue")?.rate).toBe("1545");
		expect(store.list("rates")).toHaveLength(3);
		expect(ratesAsOf(store)).toBe(D);
	});

	it("refuses a table with a bad rate before it writes anything", async () => {
		const store = await arsStore();
		for (const bad of ["0", "-5", "1e-5", "abc", "", "1,5"]) {
			await expect(
				store.transaction((tx) =>
					applyDailyTable(
						tx,
						daily([row("EUR", "official", "0.9"), row("ARS", "blue", bad)]),
					),
				),
			).rejects.toBeInstanceOf(InvalidInputError);
		}
		await expect(
			store.transaction((tx) =>
				applyDailyTable(tx, daily([row("ARS", "blue", "1545", "not a date")])),
			),
		).rejects.toBeInstanceOf(InvalidInputError);
		await expect(
			store.transaction((tx) =>
				applyDailyTable(
					tx,
					daily([row("ARS", "blue", "1545"), row("ARS", "blue", "1546")]),
				),
			),
		).rejects.toBeInstanceOf(InvalidInputError);
		// Every refusal left the table as it was.
		expect(store.list("rates")).toHaveLength(3);
		expect(store.get("rates", "ARS-blue")?.rate).toBe("1545");
		expect(ratesAsOf(store)).toBe(D);
	});

	it("an empty table empties rates and keeps asOf null", async () => {
		const store = await arsStore();
		await store.transaction((tx) => applyDailyTable(tx, daily([], null)));
		expect(store.list("rates")).toEqual([]);
		expect(ratesAsOf(store)).toBeNull();
	});

	it("keeps the rateSync row to one, with id rates", async () => {
		const store = new MemoryStore();
		await expect(
			store.transaction((tx) => tx.put("rateSync", { id: "other", asOf: null })),
		).rejects.toBeInstanceOf(InvalidInputError);
	});
});

// USD 100 on 2026-03-05 into an ARS home. Blue 1545 and official 1000 per USD,
// so by hand: blue 100 x 1545 = 154,500.00 and official 100 x 1000 = 100,000.00.
describe("a device prices from the applied daily table", () => {
	it("picks blue by default and official when asked, for an ARS home", async () => {
		const store = await arsStore();
		const blue = await book(store, { currency: "USD", amount: "100" });
		expect(blue.value).toMatchObject({
			homeAmount: "154500.00",
			rateType: "blue",
		});
		const official = await book(store, {
			id: "e2",
			currency: "USD",
			amount: "100",
			rateType: "official",
		});
		expect(official.value).toMatchObject({
			homeAmount: "100000.00",
			rateType: "official",
		});
	});

	it("gives the pick the server's figures give on the same rows", async () => {
		const store = await arsStore();
		const pick = rateLookup(
			rateRowsByCurrency(store.list("rates"), ["ARS", "EUR"]),
		);
		expect(pick("ARS", WHEN)).toMatchObject({ type: "blue", rate: 1545 });
		expect(pick("ARS", WHEN, "official")).toMatchObject({
			type: "official",
			rate: 1000,
		});
		expect(pick("EUR", WHEN)).toMatchObject({ type: "official", rate: 0.8 });
		// The same rows, grouped by hand, through pickBestRate directly.
		expect(
			pickBestRate(
				[
					{ type: "blue", rate: 1545, date: new Date(D) },
					{ type: "official", rate: 1000, date: new Date(D) },
				],
				{ date: WHEN },
			),
		).toMatchObject({ type: "blue", rate: 1545 });
	});

	it("USD has no row and is still 1", async () => {
		const store = await arsStore();
		expect(store.list("rates").some((r) => r.currency === "USD")).toBe(false);
		expect(rateLookup({})("USD", WHEN)).toMatchObject({ rate: 1 });
	});

	it("a currency the table lacks is absent and its price throws MissingRateError", async () => {
		const store = await arsStore();
		expect(store.list("rates").some((r) => r.currency === "BRL")).toBe(false);
		expect(
			rateLookup(rateRowsByCurrency(store.list("rates"), ["BRL"]))(
				"BRL",
				WHEN,
			),
		).toBeNull();
		await expect(
			book(store, { currency: "BRL", amount: "10" }),
		).rejects.toBeInstanceOf(MissingRateError);
		expect(store.list("expenses")).toEqual([]);

		// A sync that drops a currency makes it unpriceable: never 1.
		await store.transaction((tx) =>
			applyDailyTable(tx, daily([row("ARS", "blue", "1545")])),
		);
		await expect(
			book(store, { currency: "EUR", amount: "10" }),
		).rejects.toBeInstanceOf(MissingRateError);
	});
});

describe("the rate history is outside figure inputs", () => {
	const history = [
		{ date: "2026-03-01", currency: "ARS", type: "blue", unitsPerUsd: "1" },
		{ date: "2026-03-04", currency: "ARS", type: "blue", unitsPerUsd: "9999" },
		{ date: "2026-03-09", currency: "ARS", type: "blue", unitsPerUsd: "2" },
		{ date: "2026-03-04", currency: "ARS", type: "official", unitsPerUsd: "5" },
	];

	it("is not a store table", () => {
		expect(TABLE_NAMES as readonly string[]).not.toContain("rateHistory");
		expect(TABLE_NAMES as readonly string[]).not.toContain("history");
	});

	it("never changes a price or the rates table, however it disagrees", async () => {
		const store = await arsStore();
		const before = store.list("rates");
		const chart = new RateHistoryStore();
		chart.merge(history);
		// Same instant, same rows: 154,500.00 at blue 1545, not 9999 or 1.
		const blue = await book(store, { currency: "USD", amount: "100" });
		expect(blue.value.homeAmount).toBe("154500.00");
		expect(store.list("rates")).toEqual(before);
		expect(chart.list({ currency: "ARS", type: "blue" })).toHaveLength(3);
	});

	it("a price reads only settings and rates", async () => {
		const store = await arsStore();
		const read = new Set<TableName>();
		const spy: Reader = {
			get: (t, id) => {
				read.add(t);
				return store.get(t, id);
			},
			list: (t) => {
				read.add(t);
				return store.list(t);
			},
		};
		const writer = {
			...spy,
			put: () => undefined,
			delete: () => false,
		};
		await createExpense({
			id: "e9",
			title: "x",
			date: WHEN,
			currency: "USD",
			amount: "1",
		})(repos(writer));
		expect([...read].sort()).toEqual(["expenses", "rates", "settings"].sort());
		expect(read.has("rateSync" as TableName)).toBe(false);
	});

	it("lists oldest first by day, currency and type, within a range", () => {
		const chart = new RateHistoryStore();
		chart.merge([...history].reverse());
		expect(
			chart.list().map((r) => `${r.date} ${r.type} ${r.unitsPerUsd}`),
		).toEqual([
			"2026-03-01 blue 1",
			"2026-03-04 blue 9999",
			"2026-03-04 official 5",
			"2026-03-09 blue 2",
		]);
		expect(
			chart.list({ from: "2026-03-02", to: "2026-03-04", type: "blue" }),
		).toEqual([history[1]]);
	});

	it("a later page replaces a row it shares and a bad row refuses the page", () => {
		const chart = new RateHistoryStore();
		chart.merge(history);
		chart.merge([
			{ date: "2026-03-04", currency: "ARS", type: "blue", unitsPerUsd: "1550" },
		]);
		expect(
			chart.list({ from: "2026-03-04", to: "2026-03-04", type: "blue" }),
		).toEqual([
			{ date: "2026-03-04", currency: "ARS", type: "blue", unitsPerUsd: "1550" },
		]);
		expect(() =>
			chart.merge([
				{ date: "2026-03-10", currency: "ARS", type: "blue", unitsPerUsd: "7" },
				{ date: "2026-03-10", currency: "EUR", type: "official", unitsPerUsd: "0" },
			]),
		).toThrow(InvalidInputError);
		expect(chart.list({ from: "2026-03-10" })).toEqual([]);
	});
});
