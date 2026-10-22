/** Gallery fixtures for Home: the glance, Needs you and the charts. */
import { toMinor } from "@retrospend/domain/money-minor";
import type { AllocationItem } from "~/components/charts/allocation-bar";
import type { BalanceSegment } from "~/components/charts/balance-bar";
import type { MonthTotal } from "~/components/charts/monthly-bars";
import type { AreaPoint } from "~/components/charts/net-worth-area";
import type { PaceSeries } from "~/components/charts/pace-line";
import type { RankedItem } from "~/components/charts/ranked-bars";
import type { GlanceVM } from "~/components/glance/glance-strip";
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import { CAT, m, P } from "./rows";

/** Whole pesos to minor units, through the domain's exact conversion. */
const ars = (whole: number) => toMinor(String(whole), "ARS");

/** Cumulative spending per day (the mockup's ledger): October so far, all of September. */
export const PACE: PaceSeries = {
	currency: "ARS",
	days: 31,
	current: [
		124300, 306800, 438357, 446757, 1130157, 1139757, 1189157, 1334057, 1497656,
		1564376, 1613681, 1778796, 1841555, 2035129, 2189800, 2261300, 2424089,
		2438102, 2543702, 2682602, 2706602,
	].map(ars),
	previous: [
		0, 151800, 301200, 317000, 994050, 1330850, 1355350, 1496950, 1539950,
		1637750, 1637750, 1686350, 1686350, 1708850, 1735000, 1803600, 1866025,
		2018050, 2057650, 2065650, 2147450, 2202550, 2302450, 2376950, 2458050,
		2721588, 2721588, 2766588, 2814588, 3834940,
	].map(ars),
};

export const GLANCE: GlanceVM = {
	month: "2026-10-01",
	spent: m("2706602"),
	line: { kind: "perDay", perDay: m("5378"), daysLeft: 11 },
	fasterThanPlanned: true,
	pace: PACE,
	rows: [
		{ id: "toAssign", amount: m("850000"), href: "#budget" },
		{ id: "owedToYou", amount: m("1663643"), href: "#people" },
		{ id: "youOwe", amount: m("229770"), href: "#people" },
		{ id: "netWorth", amount: m("135325483"), href: "#wealth" },
	],
};

export const NEEDS_YOU: NeedsYouItemVM[] = [
	{ id: "ny5", kind: "overdue", title: "Fibra e internet", amount: m("38900") },
	{ id: "ny3", kind: "confirmPayment", person: "Lucía", amount: m("20000") },
	{
		id: "ny6",
		kind: "verify",
		person: "Lucía",
		title: "Hospedagem, segunda casa",
		amount: m("620.00", "BRL"),
	},
	{
		id: "ny7",
		kind: "verify",
		person: "Tomás",
		title: "Remeras de la banda",
		amount: m("85.00", "USD"),
	},
	{ id: "ny2", kind: "review", count: 7 },
	{ id: "ny4", kind: "due", title: "Streamly", amount: m("19225") },
	{ id: "ny8", kind: "overspent", envelope: "Restaurants", amount: m("48400") },
	{ id: "ny1", kind: "assign", amount: m("850000") },
];

export const MONTHS: MonthTotal[] = [
	{ month: "2026-05-01", total: m("2028590") },
	{ month: "2026-06-01", total: m("2147631") },
	{ month: "2026-07-01", total: m("2885069") },
	{ month: "2026-08-01", total: m("2372219") },
	{ month: "2026-09-01", total: m("3834941") },
	{ month: "2026-10-01", total: m("2706602") },
];

export const NET_WORTH: AreaPoint[] = [
	{ date: "2026-05-28", value: m("119967291") },
	{ date: "2026-06-28", value: m("123184978") },
	{ date: "2026-07-28", value: m("126095421") },
	{ date: "2026-08-28", value: m("129456371") },
	{ date: "2026-09-28", value: m("133211431") },
	{ date: "2026-10-21", value: m("135325483") },
];

export const RANKED: RankedItem[] = [
	{ id: "rent", label: "Rent", value: m("650000"), category: CAT.rent },
	{
		id: "groceries",
		label: "Groceries",
		value: m("486980"),
		category: CAT.groceries,
	},
	{
		id: "restaurants",
		label: "Restaurants",
		value: m("435421"),
		category: CAT.restaurants,
	},
	{ id: "travel", label: "Travel", value: m("303058"), category: CAT.travel },
	{ id: "home", label: "Home", value: m("145183"), category: CAT.home },
	{ id: "health", label: "Health", value: m("112000"), category: CAT.health },
];

/** States the charts must handle (R14): no data at all, and gaps. */
export const EMPTY_MONTHS: MonthTotal[] = MONTHS.map((x) => ({
	...x,
	total: null,
}));

export const ALLOCATION: AllocationItem[] = [
	{
		id: "cash",
		label: "Cash and bank",
		value: m("12758756.60"),
		share: 935,
		series: 2,
	},
	{
		id: "invest",
		label: "Investments",
		value: m("8120450"),
		share: 595,
		series: 3,
	},
	{
		id: "crypto",
		label: "Crypto",
		value: m("1751003.28"),
		share: 128,
		series: 4,
	},
	{
		id: "property",
		label: "Property",
		value: m("114504000"),
		share: 8342,
		series: 1,
	},
];

export const BALANCE_SEGMENTS: BalanceSegment[] = [
	{ person: P.paz, direction: "owed", share: 4870, amount: m("911430") },
	{ person: P.lucia, direction: "owed", share: 1787, amount: m("334460") },
	{ person: P.tomas, direction: "owed", share: 1078, amount: m("201820") },
	{ person: P.camila, direction: "owed", share: 388, amount: m("72683") },
	{ person: P.martin, direction: "owe", share: 920, amount: m("172282") },
	{
		person: { id: "vale", name: "Valentina Ruiz" },
		direction: "owe",
		share: 137,
		amount: m("25688"),
	},
];
