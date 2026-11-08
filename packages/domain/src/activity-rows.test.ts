/**
 * Activity rows shaped from stored rows held in memory, every expected value
 * derived by hand. The pg conformance test
 * (src/server/services/figures/recurring-entry.pg.test.ts) holds the SQL
 * loader to the same shaping.
 *
 * Home ARS at 1,500 per USD; days read in Buenos Aires (UTC-3). A row at
 * 2026-10-31T01:30Z is Oct 30 there and Oct 31 in UTC.
 */
import { describe, expect, it } from "vitest";
import {
	type ActivityRowInputs,
	activityRateCurrencies,
	activityRowsFrom,
	bookedRate,
	entryAmountOf,
	entryRowFrom,
	entryShareOf,
	firstName,
	type PaymentRowInput,
	type PersonalRowInput,
	rowKeyFromEntryId,
	type SharedRowInput,
	type ShapeContext,
	splitPaymentKey,
} from "./activity-rows";

const BA = "America/Argentina/Buenos_Aires";
const ME = "me";
const ctx = (o: Partial<ShapeContext> = {}): ShapeContext => ({
	userId: ME,
	timeZone: BA,
	rates: { home: "ARS", homeRate: 1500 },
	...o,
});

const personal = (o: Partial<PersonalRowInput> & { id: string }): PersonalRowInput => ({
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	title: o.id,
	amount: "100",
	currency: "ARS",
	amountInUSD: "0.07",
	homeCurrency: null,
	homeAmount: null,
	homeRate: null,
	rateType: null,
	date: new Date("2026-10-08T15:00:00Z"),
	excludeFromAnalytics: false,
	isAmortizedParent: false,
	category: null,
	childCount: 0,
	...o,
});

const empty: ActivityRowInputs = {
	personal: [],
	shares: [],
	payments: [],
	who: {},
	roles: {},
	rateRows: {},
};

const rowsOf = (
	inputs: Partial<ActivityRowInputs>,
	ids: string[],
	c = ctx(),
) =>
	activityRowsFrom(
		ids.map(rowKeyFromEntryId),
		{ ...empty, ...inputs },
		c,
	);

describe("personal rows, home ARS", () => {
	it("JPY has no minor digits and KWD three; the home value is the stored USD at today's rate", () => {
		// JPY 1,234 stored as USD 8.23: 8.23 x 1,500 = ARS 12,345.
		// KWD 12.345 stored as USD 40.1: 40.1 x 1,500 = ARS 60,150.
		const [jpy, kwd] = rowsOf(
			{
				personal: [
					personal({ id: "jpy", amount: "1234", currency: "JPY", amountInUSD: "8.23" }),
					personal({ id: "kwd", amount: "12.345", currency: "KWD", amountInUSD: "40.1" }),
				],
			},
			["jpy", "kwd"],
		);
		expect(jpy?.amount).toEqual({ minor: 1234, currency: "JPY" });
		expect(jpy?.home).toEqual({ minor: 1_234_500, currency: "ARS" });
		expect(jpy?.sortKey).toBe(1_234_500);
		expect(kwd?.amount).toEqual({ minor: 12_345, currency: "KWD" });
		expect(kwd?.home).toEqual({ minor: 6_015_000, currency: "ARS" });
	});

	it("rounds a stored 8-decimal amount half to even in its own currency", () => {
		// 4.1145 KWD ties between 4.114 and 4.115: even, 4.114. 4.1155 ties to 4.116.
		// JPY 0.5 ties to 0, JPY 1.5 to 2, JPY 333.33333333 to 333.
		const rows = rowsOf(
			{
				personal: [
					personal({ id: "a", amount: "4.1145", currency: "KWD" }),
					personal({ id: "b", amount: "4.1155", currency: "KWD" }),
					personal({ id: "c", amount: "0.5", currency: "JPY" }),
					personal({ id: "d", amount: "1.5", currency: "JPY" }),
					personal({ id: "e", amount: "333.33333333", currency: "JPY" }),
				],
			},
			["a", "b", "c", "d", "e"],
		);
		expect(rows.map((r) => r.amount.minor)).toEqual([4114, 4116, 0, 2, 333]);
	});

	it("a row in the home currency has no home value of its own, even with no rate at all", () => {
		const [row] = rowsOf(
			{ personal: [personal({ id: "a", amount: "2500.5" })] },
			["a"],
			ctx({ rates: { home: "ARS", homeRate: null } }),
		);
		expect(row && "home" in row).toBe(false);
		expect(row?.amount).toEqual({ minor: 250_050, currency: "ARS" });
		expect(row?.sortKey).toBe(250_050);
	});

	it("a foreign row with no home rate has a null home value and sort key, never a rate of 1", () => {
		const [row] = rowsOf(
			{
				personal: [
					personal({ id: "a", amount: "10", currency: "USD", amountInUSD: "10" }),
				],
			},
			["a"],
			ctx({ rates: { home: "ARS", homeRate: null } }),
		);
		expect(row?.home).toBeNull();
		expect(row?.sortKey).toBeNull();
	});

	it("keeps the value booked at save, and names a rate type only with its number and when it is not the default", () => {
		// USD 100 booked at ARS 1,400 on blue = ARS 140,000, whatever today's rate.
		const booked = personal({
			id: "booked",
			amount: "100",
			currency: "USD",
			amountInUSD: "100",
			homeCurrency: "ARS",
			homeAmount: "140000",
			homeRate: "1400.000000000000",
			rateType: "blue",
		});
		const [row] = rowsOf({ personal: [booked] }, ["booked"]);
		expect(row?.home).toEqual({ minor: 14_000_000, currency: "ARS" });
		expect(row?.rateType).toBe("blue");
		expect(row?.rate).toBe("1400");
		const [isDefault] = rowsOf({ personal: [booked] }, ["booked"], ctx({ defaultRateType: "blue" }));
		expect(isDefault && "rateType" in isDefault).toBe(false);
		// No booked rate, no type; a row booked in another home currency uses today's.
		const [noRate] = rowsOf({ personal: [{ ...booked, homeRate: null }] }, ["booked"]);
		expect(noRate && "rateType" in noRate).toBe(false);
		const [other] = rowsOf({ personal: [{ ...booked, homeCurrency: "EUR" }] }, ["booked"]);
		expect(other?.home).toEqual({ minor: 15_000_000, currency: "ARS" });
		expect(other && "rateType" in other).toBe(false);
	});

	it("reads the day in the viewer's zone: 01:30Z on Oct 31 is Oct 30 in Buenos Aires and Oct 31 in UTC", () => {
		const row = personal({ id: "a", date: new Date("2026-10-31T01:30:00Z") });
		expect(rowsOf({ personal: [row] }, ["a"])[0]?.date).toBe("2026-10-30");
		expect(rowsOf({ personal: [row] }, ["a"], ctx({ timeZone: "UTC" }))[0]?.date).toBe("2026-10-31");
	});

	it("says how each kind reads and why the totals leave a row out", () => {
		const kinds = rowsOf(
			{
				personal: [
					personal({ id: "out" }),
					personal({ id: "in", direction: "IN", inType: "INCOME" }),
					personal({ id: "refund", direction: "IN", inType: "REFUND" }),
					personal({ id: "own", entryKind: "NOT_SPENDING" }),
					personal({ id: "hidden", excludeFromAnalytics: true }),
					personal({
						id: "cat",
						category: {
							id: "c1",
							userId: ME,
							name: "Pay",
							color: "blue",
							icon: null,
							kind: "INCOME",
						},
					}),
					personal({ id: "parent", isAmortizedParent: true, childCount: 3 }),
					personal({ id: "bare", isAmortizedParent: true, childCount: 0 }),
					personal({ id: "hiddenIn", direction: "IN", inType: "INCOME", excludeFromAnalytics: true }),
				],
			},
			["out", "in", "refund", "own", "hidden", "cat", "parent", "bare", "hiddenIn"],
		);
		expect(kinds.map((r) => [r.id, r.kind, r.notCounted ?? false, r.spread?.months ?? 0])).toEqual([
			["out", "expense", false, 0],
			["in", "income", false, 0],
			["refund", "refund", false, 0],
			["own", "transfer", false, 0],
			["hidden", "expense", true, 0],
			["cat", "expense", true, 0],
			["parent", "expense", false, 3],
			["bare", "expense", true, 0],
			["hiddenIn", "income", false, 0],
		]);
		expect(kinds[5]?.category).toMatchObject({ id: "c1", tone: 7 });
	});
});

const tx = (
	o: Partial<SharedRowInput["transaction"]> & { id: string },
): SharedRowInput["transaction"] => ({
	description: "Dinner",
	amount: "9000",
	currency: "ARS",
	exchangeRate: null,
	date: new Date("2026-10-09T15:00:00Z"),
	paidByType: "user",
	paidById: "ben",
	createdByType: "user",
	createdById: "ben",
	isLocked: false,
	projectId: null,
	project: null,
	category: null,
	splitParticipants: [
		{ participantType: "user", participantId: ME },
		{ participantType: "user", participantId: "ben" },
	],
	...o,
});
const share = (
	t: SharedRowInput["transaction"],
	shareAmount: string,
	verificationStatus = "ACCEPTED",
): SharedRowInput => ({ shareAmount, verificationStatus, transaction: t });

const people = {
	[`user:${ME}`]: { name: "Ana Ruiz", imageUrl: null },
	"user:ben": { name: "Martín Pérez", imageUrl: "/api/images/b.png" },
};

describe("shared rows", () => {
	it("shows the full amount and your share, with no home value in the home currency", () => {
		const [row] = rowsOf(
			{ shares: [share(tx({ id: "d" }), "3000")], who: people },
			["shared:d"],
		);
		expect(row).toMatchObject({
			id: "shared:d",
			source: "shared",
			entityId: "d",
			amount: { minor: 900_000, currency: "ARS" },
			share: { minor: 300_000, currency: "ARS" },
			sortKey: 900_000,
			payerId: "user:ben",
			payerName: "Martín",
			mine: false,
		});
		expect(row && "home" in row).toBe(false);
	});

	it("prices a USD expense at today's home rate: USD 90 is ARS 135,000 and your USD 30 is ARS 45,000", () => {
		const [row] = rowsOf(
			{
				shares: [share(tx({ id: "u", amount: "90", currency: "USD" }), "30")],
				who: people,
			},
			["shared:u"],
		);
		expect(row?.home).toEqual({ minor: 13_500_000, currency: "ARS" });
		expect(row?.share).toEqual({ minor: 4_500_000, currency: "ARS" });
		expect(row?.sortKey).toBe(13_500_000);
	});

	it("uses the rate captured when saved before any lookup: EUR 60 at 0.75 per USD is USD 80, ARS 120,000", () => {
		const [row] = rowsOf(
			{
				shares: [
					share(tx({ id: "e", amount: "60", currency: "EUR", exchangeRate: "0.75" }), "20"),
				],
				rateRows: { EUR: [{ type: "official", rate: 0.5, date: new Date("2026-10-09T00:00:00Z") }] },
			},
			["shared:e"],
		);
		expect(row?.home).toEqual({ minor: 12_000_000, currency: "ARS" });
		// Your EUR 20 is USD 26.666667, ARS 40,000.
		expect(row?.share).toEqual({ minor: 4_000_000, currency: "ARS" });
	});

	it("looks the rate up at the expense's date when none was captured", () => {
		// EUR rows: 0.8 on Oct 1, 0.5 on Oct 20. On Oct 9 the Oct 1 row wins:
		// EUR 60 is USD 75 = ARS 112,500; your EUR 20 is USD 25 = ARS 37,500.
		const [row] = rowsOf(
			{
				shares: [share(tx({ id: "e", amount: "60", currency: "EUR" }), "20")],
				rateRows: {
					EUR: [
						{ type: "official", rate: 0.8, date: new Date("2026-10-01T00:00:00Z") },
						{ type: "official", rate: 0.5, date: new Date("2026-10-20T00:00:00Z") },
					],
				},
			},
			["shared:e"],
		);
		expect(row?.home).toEqual({ minor: 11_250_000, currency: "ARS" });
		expect(row?.share).toEqual({ minor: 3_750_000, currency: "ARS" });
	});

	it("with no rate at all the home value is null and the share stays in the expense's currency", () => {
		const [row] = rowsOf(
			{ shares: [share(tx({ id: "e", amount: "60", currency: "EUR" }), "20")] },
			["shared:e"],
		);
		expect(row?.home).toBeNull();
		expect(row?.sortKey).toBeNull();
		expect(row?.share).toEqual({ minor: 2000, currency: "EUR" });
	});

	it("a JPY share rounds to whole yen and a KWD one to fils, half to even", () => {
		// JPY 1,000 split three ways: 333.33333333 is 333. KWD 4.1155 is 4.116.
		const jpy = share(tx({ id: "j", amount: "1000", currency: "JPY" }), "333.33333333");
		const kwd = share(tx({ id: "k", amount: "8.231", currency: "KWD" }), "4.1155");
		const rows = rowsOf({ shares: [jpy, kwd] }, ["shared:j", "shared:k"]);
		expect(rows.map((r) => r.amount)).toEqual([
			{ minor: 1000, currency: "JPY" },
			{ minor: 8231, currency: "KWD" },
		]);
		// With no rates the shares keep their currencies.
		expect(rows.map((r) => r.share)).toEqual([
			{ minor: 333, currency: "JPY" },
			{ minor: 4116, currency: "KWD" },
		]);
	});

	it("waiting: someone else's pending share is for review, yours is not, a rejected one is rejected", () => {
		const mineTx = tx({ id: "m", createdById: ME });
		const rows = rowsOf(
			{
				shares: [
					share(tx({ id: "p" }), "1", "PENDING"),
					share(mineTx, "1", "PENDING"),
					share(tx({ id: "r" }), "1", "REJECTED"),
					share(tx({ id: "a" }), "1", "ACCEPTED"),
				],
			},
			["shared:p", "shared:m", "shared:r", "shared:a"],
		);
		expect(rows.map((r) => r.waiting ?? null)).toEqual(["review", null, "rejected", null]);
	});

	it("can edit: the creator of a standalone expense, a project's organizer or editor, a contributor only their own, never a locked one", () => {
		const proj = { id: "pr", name: "Trip" };
		const rows = (roles: Record<string, string>, t: Partial<SharedRowInput["transaction"]>) =>
			rowsOf(
				{ shares: [share(tx({ id: "x", ...t }), "1")], roles },
				["shared:x"],
			)[0]?.canEdit;
		expect(rows({}, { createdById: ME })).toBe(true);
		expect(rows({}, {})).toBe(false);
		const inProject = { projectId: "pr", project: proj };
		expect(rows({ pr: "ORGANIZER" }, inProject)).toBe(true);
		expect(rows({ pr: "EDITOR" }, inProject)).toBe(true);
		expect(rows({ pr: "CONTRIBUTOR" }, inProject)).toBe(false);
		expect(rows({ pr: "CONTRIBUTOR" }, { ...inProject, createdById: ME })).toBe(true);
		expect(rows({ pr: "VIEWER" }, { ...inProject, createdById: ME })).toBe(false);
		expect(rows({ pr: "ORGANIZER" }, { ...inProject, isLocked: true })).toBe(false);
	});

	it("adds the payer to the people when the split rows leave them out, and names who paid only when it is not you", () => {
		const hidden = tx({
			id: "h",
			splitParticipants: [{ participantType: "user", participantId: ME }],
		});
		const own = tx({ id: "o", paidById: ME, createdById: ME });
		const [h, o] = rowsOf(
			{ shares: [share(hidden, "1"), share(own, "1")], who: people },
			["shared:h", "shared:o"],
		);
		expect(h?.people?.map((p) => [p.id, p.name, p.isSelf])).toEqual([
			["user:ben", "Martín Pérez", false],
			[`user:${ME}`, "Ana Ruiz", true],
		]);
		expect(h?.people?.[0]?.imageUrl).toBe("/api/images/b.png");
		expect(h?.payerName).toBe("Martín");
		expect(o && "payerName" in o).toBe(false);
	});

	it("shows only your own category on a shared expense", () => {
		const cat = (userId: string) => ({
			id: "c",
			userId,
			name: "Food",
			color: "amber",
			icon: "utensils",
			kind: "EXPENSE",
		});
		const [mine, theirs] = rowsOf(
			{
				shares: [
					share(tx({ id: "a", category: cat(ME) }), "1"),
					share(tx({ id: "b", category: cat("ben") }), "1"),
				],
			},
			["shared:a", "shared:b"],
		);
		expect(mine?.category).toEqual({ id: "c", name: "Food", icon: "utensils", tone: 3 });
		expect(theirs?.category).toBeNull();
	});
});

const pay = (
	o: Partial<PaymentRowInput> & { id: string },
): PaymentRowInput => ({
	paymentGroupId: null,
	currency: "ARS",
	amount: "500",
	status: "FINALIZED",
	initiatedAt: new Date("2026-10-10T15:00:00Z"),
	fromParticipantType: "user",
	fromParticipantId: "ben",
	toParticipantType: "user",
	toParticipantId: ME,
	project: null,
	...o,
});

describe("payment rows", () => {
	it("sums the rows of one payment group and currency exactly, takes the earliest day, and is pending while any row is proposed", () => {
		// 300.10 + 200.20 = 500.30, which a float sum would not give exactly.
		const [row] = rowsOf(
			{
				payments: [
					pay({
						id: "s1",
						paymentGroupId: "g",
						amount: "300.10",
						project: { id: "a", name: "A" },
						initiatedAt: new Date("2026-10-12T15:00:00Z"),
					}),
					pay({
						id: "s2",
						paymentGroupId: "g",
						amount: "200.20",
						status: "PROPOSED",
						project: { id: "b", name: "B" },
						initiatedAt: new Date("2026-10-10T15:00:00Z"),
					}),
				],
				who: people,
			},
			["payment:g|ARS"],
		);
		expect(row).toMatchObject({
			id: "payment:g|ARS",
			entityId: "g",
			kind: "payment",
			amount: { minor: 50_030, currency: "ARS" },
			date: "2026-10-10",
			pending: true,
			project: null,
			mine: false,
			locked: true,
			canEdit: false,
			payment: { direction: "received", counterparty: "Martín" },
		});
	});

	it("a legacy payment with no group is its own id, and one project names the project", () => {
		const [row] = rowsOf(
			{
				payments: [
					pay({
						id: "solo",
						fromParticipantId: ME,
						toParticipantId: "ben",
						project: { id: "a", name: "A" },
					}),
				],
				who: people,
			},
			["payment:solo|ARS"],
		);
		expect(row).toMatchObject({
			entityId: "solo",
			project: { id: "a", name: "A" },
			mine: true,
			payment: { direction: "sent", counterparty: "Martín" },
		});
		expect(row && "pending" in row).toBe(false);
	});

	it("prices a foreign payment at its date: USD 10 is ARS 15,000; JPY 3,000 at 150 is USD 20, ARS 30,000", () => {
		const [usd, jpy] = rowsOf(
			{
				payments: [
					pay({ id: "u", currency: "USD", amount: "10" }),
					pay({ id: "j", currency: "JPY", amount: "3000" }),
				],
				rateRows: { JPY: [{ type: "official", rate: 150, date: new Date("2026-10-01T00:00:00Z") }] },
			},
			["payment:u|USD", "payment:j|JPY"],
		);
		expect(usd?.home).toEqual({ minor: 1_500_000, currency: "ARS" });
		expect(jpy?.amount).toEqual({ minor: 3000, currency: "JPY" });
		expect(jpy?.home).toEqual({ minor: 3_000_000, currency: "ARS" });
	});

	it("a currency with no rate leaves the home value null and the amount as paid", () => {
		const [row] = rowsOf(
			{ payments: [pay({ id: "x", currency: "KWD", amount: "12.345" })] },
			["payment:x|KWD"],
		);
		expect(row?.amount).toEqual({ minor: 12_345, currency: "KWD" });
		expect(row?.home).toBeNull();
		expect(row?.sortKey).toBeNull();
	});
});

describe("keys and entry figures", () => {
	it("returns rows in the keys' order and skips a key with no row", () => {
		const rows = rowsOf(
			{ personal: [personal({ id: "a" }), personal({ id: "b" })] },
			["b", "gone", "a", "shared:nope", "payment:nope|ARS"],
		);
		expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
	});

	it("reads an entry id as a personal id, shared:<id> or payment:<key>", () => {
		expect(rowKeyFromEntryId("abc")).toEqual({ src: "p", id: "abc" });
		expect(rowKeyFromEntryId("shared:abc")).toEqual({ src: "s", id: "abc" });
		expect(rowKeyFromEntryId("payment:g|ARS")).toEqual({ src: "g", id: "g|ARS" });
		expect(splitPaymentKey("a|b|ARS")).toEqual({ group: "a|b", currency: "ARS" });
	});

	it("entry.amount is the row's amount whatever its kind and entry.share only a shared row's share", () => {
		const inputs: ActivityRowInputs = {
			...empty,
			personal: [personal({ id: "p", amount: "12.5", currency: "USD", amountInUSD: "12.5" })],
			shares: [share(tx({ id: "d" }), "3000")],
			payments: [pay({ id: "g" })],
		};
		const row = (id: string) => entryRowFrom(id, inputs, ctx());
		expect(entryAmountOf(row("p"))).toEqual([{ minor: 1250, currency: "USD" }]);
		expect(entryAmountOf(row("shared:d"))).toEqual([{ minor: 900_000, currency: "ARS" }]);
		expect(entryAmountOf(row("payment:g|ARS"))).toEqual([{ minor: 50_000, currency: "ARS" }]);
		expect(entryShareOf(row("shared:d"))).toEqual([{ minor: 300_000, currency: "ARS" }]);
		expect(entryShareOf(row("p"))).toEqual([]);
		expect(entryShareOf(row("payment:g|ARS"))).toEqual([]);
		expect(entryAmountOf(row("nope"))).toEqual([]);
	});

	it("names the currencies to price: an uncaptured shared expense and every payment, USD aside", () => {
		expect(
			activityRateCurrencies({
				shares: [
					share(tx({ id: "a", currency: "EUR" }), "1"),
					share(tx({ id: "b", currency: "GBP", exchangeRate: "0.8" }), "1"),
					share(tx({ id: "c", currency: "USD" }), "1"),
				],
				payments: [pay({ id: "p", currency: "JPY" }), pay({ id: "q", currency: "EUR" })],
			}),
		).toEqual(["EUR", "JPY"]);
	});

	it("words a booked rate from its stored text, only when booked in the home currency", () => {
		expect(bookedRate({ homeCurrency: "ARS", homeRate: "1545.500000000000" }, "ARS")).toBe("1545.5");
		expect(bookedRate({ homeCurrency: "EUR", homeRate: "1" }, "ARS")).toBeNull();
		expect(bookedRate({ homeCurrency: "ARS", homeRate: null }, "ARS")).toBeNull();
		expect(firstName({ name: "  Ana  Ruiz", imageUrl: null })).toBe("Ana");
		expect(firstName(undefined)).toBe("");
	});
});
