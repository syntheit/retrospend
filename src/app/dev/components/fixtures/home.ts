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

/** Cumulative spending per day: October so far (21 days), all of September. */
export const PACE: PaceSeries = {
	currency: "ARS",
	days: 31,
	current: [
		90000, 160000, 190000, 195000, 450000, 470000, 480000, 560000, 640000,
		700000, 760000, 820000, 950000, 1080000, 1200000, 1390000, 1560000, 1720000,
		1980000, 2240000, 2706602,
	].map(ars),
	previous: [
		40000, 90000, 140000, 150000, 520000, 560000, 600000, 680000, 760000,
		800000, 860000, 950000, 1010000, 1060000, 1130000, 1200000, 1260000,
		1330000, 1420000, 1500000, 1560000, 1630000, 1700000, 1790000, 1850000,
		2010000, 2060000, 2090000, 2120000, 3100000,
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
	{ month: "2026-05-01", total: m("2010000") },
	{ month: "2026-06-01", total: m("2120000") },
	{ month: "2026-07-01", total: m("2870000") },
	{ month: "2026-08-01", total: m("2350000") },
	{ month: "2026-09-01", total: m("3820000") },
	{ month: "2026-10-01", total: m("2706602") },
];

export const NET_WORTH: AreaPoint[] = [
	{ date: "2026-05-28", value: m("98400000") },
	{ date: "2026-06-28", value: m("106900000") },
	{ date: "2026-07-28", value: m("114300000") },
	{ date: "2026-08-28", value: m("122800000") },
	{ date: "2026-09-28", value: m("131600000") },
	{ date: "2026-10-21", value: m("135325483") },
];

export const RANKED: RankedItem[] = [
	{
		id: "groceries",
		label: "Groceries",
		value: m("463200"),
		category: CAT.groceries,
	},
	{ id: "rent", label: "Rent", value: m("325000"), category: CAT.rent },
	{
		id: "restaurants",
		label: "Restaurants",
		value: m("268400"),
		category: CAT.restaurants,
	},
	{ id: "health", label: "Health", value: m("112000"), category: CAT.health },
	{
		id: "transport",
		label: "Transport",
		value: m("94300"),
		category: CAT.transport,
	},
	{
		id: "utilities",
		label: "Utilities",
		value: m("46800"),
		category: CAT.utilities,
	},
];

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
