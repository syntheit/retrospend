import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { RATE_SYNC_ID, SETTINGS_ID, type TableRows } from "./port";
import {
	type CaptureBody,
	CLOCK_SKEW_MS,
	type CreateCapture,
	compareCreate,
	rateDefaultsKey,
} from "./write-parity";

// Expected rows are derived by hand from the same rules as
// expense-create-vectors.ts (rates are units per USD; the home amount is one
// division from the table rates, half to even at the home currency's decimals).

const BA = "America/Argentina/Buenos_Aires";
const SENT = Date.parse("2026-03-05T15:00:00Z");
const RATE_DAY = new Date("2026-03-05T00:00:00Z");

type Rate = [currency: string, type: string, perUsd: string];
type Settings = TableRows["settings"];

const settingsOf = (
	homeCurrency: string,
	timeZone: string,
	defaultRateTypes?: Record<string, string>,
): Settings => ({
	id: SETTINGS_ID,
	homeCurrency,
	timeZone,
	startDay: 1,
	hiddenProjectIds: [],
	...(defaultRateTypes ? { defaultRateTypes } : {}),
});

const ARS = settingsOf("ARS", BA);
const ARS_RATES: Rate[] = [
	["ARS", "blue", "1545"],
	["ARS", "official", "1000"],
	["EUR", "official", "0.8"],
];

type Synced = TableRows["expenses"];

/** The row the server stores for USD 100 in an ARS home at blue: 100 x 1545 = 154500.00. */
const usd100: Synced = {
	id: "e1",
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	isAmortizedParent: false,
	excludeFromAnalytics: false,
	categoryKind: null,
	categoryId: null,
	date: new Date("2026-03-05T03:00:00Z"),
	currency: "USD",
	amount: "100",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1545",
	homeAmount: "154500.00",
	pricingSource: "MANUAL",
	title: "x",
	version: "2026-03-05T12:00:00.000Z",
};

const body = (over: Partial<CaptureBody> = {}): CaptureBody => ({
	amount: "100",
	currency: "USD",
	date: "2026-03-05",
	...over,
});

const capture = (
	over: {
		zone?: string;
		homeCurrency?: string;
		at?: number;
		body?: CaptureBody;
	} = {},
	settings: Settings = ARS,
): CreateCapture => ({
	id: "e1",
	kind: "expense",
	body: body(),
	zone: settings.timeZone,
	homeCurrency: settings.homeCurrency,
	rateDefaults: rateDefaultsKey(settings),
	at: SENT,
	...over,
});

const skippable = (kind: "split" | "transfer"): CreateCapture => ({
	...capture(),
	kind,
	body: undefined,
});

interface World {
	settings?: Settings | null;
	rates?: Rate[];
	asOf?: string | null;
	synced?: Partial<Synced>;
	categories?: TableRows["categories"][];
}

async function live({
	settings = ARS,
	rates = ARS_RATES,
	asOf = "2026-03-05T09:05:00Z",
	synced = {},
	categories = [],
}: World = {}) {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		if (settings) tx.put("settings", settings);
		for (const [currency, type, rate] of rates)
			tx.put("rates", {
				id: `${currency}:${type}`,
				currency,
				type,
				rate,
				date: RATE_DAY,
			});
		tx.put("rateSync", { id: RATE_SYNC_ID, asOf });
		for (const c of categories) tx.put("categories", c);
		tx.put("expenses", { ...usd100, ...synced });
	});
	return store;
}

const verdict = async (world: World, c: CreateCapture = capture()) =>
	compareCreate((await live(world)).snapshot(), c);

const food: TableRows["categories"] = {
	id: "cat",
	kind: "EXPENSE",
	name: "Food",
	color: "red",
	icon: null,
	excludeByDefault: false,
};

describe("a create the device books exactly as the server did", () => {
	it("matches USD 100 at the default blue rate of an ARS home", async () => {
		expect(await verdict({})).toEqual({ id: "e1", outcome: "match" });
	});

	it("matches a fallback leg: EUR 50 has no blue row, so official 0.8 on its leg and blue 1545 on the home leg", async () => {
		// 1.25 USD per EUR x 1545 = 1931.25; 50 x 1931.25 = 96562.50; USD value 62.50.
		const eur: Partial<Synced> = {
			currency: "EUR",
			amount: "50",
			amountInUSD: "62.50",
			exchangeRate: "0.8",
			homeRate: "1931.25",
			homeAmount: "96562.50",
		};
		expect(
			await verdict(
				{ synced: eur },
				capture({ body: body({ amount: "50", currency: "EUR" }) }),
			),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("matches the other rate type when the body picks it: official 1000 gives 100000.00", async () => {
		const official: Partial<Synced> = {
			rateType: "official",
			homeRate: "1000",
			homeAmount: "100000.00",
		};
		expect(
			await verdict(
				{ synced: official },
				capture({ body: body({ rateType: "official" }) }),
			),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("matches a typed rate: 1 USD = 1234.5 ARS gives 12345.00 for USD 10", async () => {
		const typed: Partial<Synced> = {
			amount: "10",
			amountInUSD: "10",
			rateType: "custom",
			homeRate: "1234.5",
			homeAmount: "12345.00",
		};
		expect(
			await verdict(
				{ synced: typed },
				capture({ body: body({ amount: "10", customRate: "1234.5" }) }),
			),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("uses the saved default rate type of the home currency", async () => {
		const settings = settingsOf("ARS", BA, { ARS: "official" });
		const official: Partial<Synced> = {
			rateType: "official",
			homeRate: "1000",
			homeAmount: "100000.00",
		};
		expect(
			await verdict({ settings, synced: official }, capture({}, settings)),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("matches a category: its id and kind are compared with the row's", async () => {
		const row: Partial<Synced> = { categoryId: "cat", categoryKind: "EXPENSE" };
		expect(
			await verdict(
				{ synced: row, categories: [food] },
				capture({ body: body({ categoryId: "cat" }) }),
			),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("compares decimals by value, not by their text", async () => {
		const padded: Partial<Synced> = {
			amount: "100.00000000",
			amountInUSD: "100.00",
			exchangeRate: "1.000000",
			homeRate: "1545.000000000000",
			homeAmount: "154500",
		};
		expect(await verdict({ synced: padded })).toEqual({
			id: "e1",
			outcome: "match",
		});
	});

	it("rounds a JPY home half to even and reads the day in Tokyo: 2026-03-01 starts at 15:00Z on Feb 28", async () => {
		// USD 10.06 x 125 = 1257.5, a tie: the even neighbor is 1258 (JPY has no decimals).
		const tokyo = settingsOf("JPY", "Asia/Tokyo");
		const row: Partial<Synced> = {
			date: new Date("2026-02-28T15:00:00Z"),
			amount: "10.06",
			amountInUSD: "10.06",
			rateType: "official",
			homeCurrency: "JPY",
			homeRate: "125",
			homeAmount: "1258",
		};
		const c = capture(
			{ body: body({ amount: "10.06", date: "2026-03-01" }) },
			tokyo,
		);
		const world = {
			settings: tokyo,
			rates: [["JPY", "official", "125"]] as Rate[],
		};
		expect(await verdict({ ...world, synced: row }, c)).toEqual({
			id: "e1",
			outcome: "match",
		});
		// The same row dated at UTC midnight is another instant: only the date differs.
		expect(
			await verdict(
				{
					...world,
					synced: { ...row, date: new Date("2026-03-01T00:00:00Z") },
				},
				c,
			),
		).toEqual({ id: "e1", outcome: "differs", fields: ["date"] });
	});

	it("keeps three decimals for a KWD home: USD 10.01 x 0.25 = 2.5025 ties to the even 2.502", async () => {
		const kuwait = settingsOf("KWD", "Asia/Kuwait");
		const row: Partial<Synced> = {
			date: new Date("2026-03-04T21:00:00Z"),
			amount: "10.01",
			amountInUSD: "10.01",
			rateType: "official",
			homeCurrency: "KWD",
			homeRate: "0.25",
			homeAmount: "2.502",
		};
		expect(
			await verdict(
				{ settings: kuwait, rates: [["KWD", "official", "0.25"]], synced: row },
				capture({ body: body({ amount: "10.01" }) }, kuwait),
			),
		).toEqual({ id: "e1", outcome: "match" });
	});
});

describe("a difference is named by field, not by amount", () => {
	it("names the home amount when the server booked another one", async () => {
		expect(await verdict({ synced: { homeAmount: "154000.00" } })).toEqual({
			id: "e1",
			outcome: "differs",
			fields: ["homeAmount"],
		});
	});

	it("names the rate type, rate and home amount when the server used the official rate", async () => {
		expect(
			await verdict({
				synced: {
					rateType: "official",
					homeRate: "1000",
					homeAmount: "100000.00",
				},
			}),
		).toEqual({
			id: "e1",
			outcome: "differs",
			fields: ["rateType", "homeRate", "homeAmount"],
		});
	});

	it.each<[string, Partial<Synced>]>([
		["status", { status: "DRAFT" }],
		["direction", { direction: "IN" }],
		["entryKind", { entryKind: "ADJUSTMENT" }],
		["inType", { inType: "REFUND" }],
		["isAmortizedParent", { isAmortizedParent: true }],
		["categoryKind", { categoryKind: "INCOME" }],
		["categoryId", { categoryId: "other" }],
		["date", { date: new Date("2026-03-05T03:00:01Z") }],
		["currency", { currency: "EUR" }],
		["amount", { amount: "100.00000001" }],
		["amountInUSD", { amountInUSD: "100.01" }],
		["exchangeRate", { exchangeRate: "1.000001" }],
		["rateType", { rateType: "official" }],
		["homeCurrency", { homeCurrency: "USD" }],
		["homeRate", { homeRate: "1545.000000000001" }],
		["homeAmount", { homeAmount: "154500.01" }],
		["pricingSource", { pricingSource: "blue" }],
	])("compares %s", async (field, change) => {
		expect(await verdict({ synced: change })).toEqual({
			id: "e1",
			outcome: "differs",
			fields: [field],
		});
	});

	it("does not compare excludeFromAnalytics: the body's value is passed, not read back", async () => {
		expect(await verdict({ synced: { excludeFromAnalytics: true } })).toEqual({
			id: "e1",
			outcome: "match",
		});
	});
});

describe("what is skipped, with its code", () => {
	const skip = (code: string) => ({ id: "e1", outcome: "skipped", code });

	it("skips a spread, but not an amortizeOver of 1", async () => {
		expect(
			await verdict({}, capture({ body: body({ amortizeOver: 2 }) })),
		).toEqual(skip("spread"));
		expect(
			await verdict({}, capture({ body: body({ amortizeOver: 1 }) })),
		).toEqual({ id: "e1", outcome: "match" });
	});

	it("skips a split and a transfer, whatever the rows hold", async () => {
		expect(await verdict({}, skippable("split"))).toEqual(skip("split"));
		expect(await verdict({}, skippable("transfer"))).toEqual(skip("transfer"));
	});

	it("skips a category the device has not received", async () => {
		expect(
			await verdict({}, capture({ body: body({ categoryId: "cat" }) })),
		).toEqual(skip("unknown_category"));
	});

	it("skips a server row with no home booking", async () => {
		expect(
			await verdict({ synced: { homeRate: null, homeAmount: null } }),
		).toEqual(skip("no_rate"));
	});

	it("skips when the device holds no settings", async () => {
		expect(await verdict({ settings: null })).toEqual(skip("no_settings"));
	});

	it("skips when the rates changed after the send, and compares when they did not", async () => {
		const later = new Date(SENT + 1).toISOString();
		expect(await verdict({ asOf: later })).toEqual(skip("rates_moved"));
		expect(await verdict({ asOf: null })).toEqual({
			id: "e1",
			outcome: "match",
		});
	});

	it("allows for clocks that differ: rates stamped within the margin before the send count as moved", async () => {
		const at = (ms: number) =>
			new Date(SENT - CLOCK_SKEW_MS + ms).toISOString();
		// Exactly the margin before the send is outside it; a millisecond later is inside.
		expect(await verdict({ asOf: at(0) })).toEqual({
			id: "e1",
			outcome: "match",
		});
		expect(await verdict({ asOf: at(1) })).toEqual(skip("rates_moved"));
		// The send itself, and a server clock a minute behind the phone's.
		expect(await verdict({ asOf: new Date(SENT).toISOString() })).toEqual(
			skip("rates_moved"),
		);
		expect(
			await verdict({ asOf: new Date(SENT - 60_000).toISOString() }),
		).toEqual(skip("rates_moved"));
	});

	it("skips a rate stamp it cannot read", async () => {
		expect(await verdict({ asOf: "not a date" })).toEqual(skip("rates_moved"));
	});

	it("skips when the preferred rate types changed after the send", async () => {
		const changed = settingsOf("ARS", BA, { ARS: "official" });
		expect(await verdict({ settings: changed })).toEqual(
			skip("settings_moved"),
		);
	});

	it("skips when the zone changed after the send", async () => {
		const moved = settingsOf("ARS", "Asia/Tokyo");
		expect(await verdict({ settings: moved })).toEqual(skip("settings_moved"));
	});

	it("skips when the home currency changed after the send", async () => {
		const moved = settingsOf("EUR", BA);
		expect(await verdict({ settings: moved })).toEqual(skip("settings_moved"));
	});

	it("does not mind the order of the preferred rate types", () => {
		const a = settingsOf("ARS", BA, { ARS: "blue", EUR: "official" });
		const b = settingsOf("ARS", BA, { EUR: "official", ARS: "blue" });
		expect(rateDefaultsKey(a)).toBe(rateDefaultsKey(b));
		expect(rateDefaultsKey(a)).not.toBe(rateDefaultsKey(ARS));
	});
});

describe("what is a finding", () => {
	it("is rate_missing, never a rate of 1, when the device lacks the rate the server used", async () => {
		const eur: Partial<Synced> = {
			currency: "EUR",
			amount: "50",
			amountInUSD: "62.50",
			exchangeRate: "0.8",
			homeRate: "1931.25",
			homeAmount: "96562.50",
		};
		expect(
			await verdict(
				{ synced: eur, rates: [["ARS", "blue", "1545"]] },
				capture({ body: body({ amount: "50", currency: "EUR" }) }),
			),
		).toEqual({ id: "e1", outcome: "rate_missing" });
	});

	it("is refused when the device will not book it: an income category holds no expense", async () => {
		const income = { ...food, kind: "INCOME" };
		expect(
			await verdict(
				{ categories: [income] },
				capture({ body: body({ categoryId: "cat" }) }),
			),
		).toEqual({ id: "e1", outcome: "refused" });
	});

	it("is refused on a zone it cannot read, not thrown", async () => {
		const odd = settingsOf("ARS", "Not/AZone");
		expect(await verdict({ settings: odd }, capture({}, odd))).toEqual({
			id: "e1",
			outcome: "refused",
		});
	});
});
