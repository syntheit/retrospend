import "server-only";

import { type Money, subtractMoney } from "@retrospend/domain/money-minor";
import type { AccountKind } from "~/components/rows/types";
import {
	type AssetTypeKey,
	type GroupKey,
	RANGES,
	type WealthAccount,
	type WealthGroup,
	type WealthPoint,
	type WealthRange,
	type WealthShare,
	type WealthView,
} from "../types";
import { moneyFromMajor, owing, shareOf, sumMoney } from "./money-dto";

/** The parts of wealth.getDashboard the page reads (float major units today). */
export type DashboardInput = {
	totalNetWorth: number;
	totalLiquidAssets: number;
	netWorth30DaysAgo: number | null;
	history: { date: string; amount: number }[];
	assets: {
		id: string;
		name: string;
		type: AssetTypeKey;
		currency: string;
		balance: number;
		balanceInTargetCurrency: number;
		exchangeRateType: string | null;
		isLiquid: boolean;
		interestRate: number | null;
		rateMissing: boolean;
		updatedAt: Date;
	}[];
	closedAssets: {
		id: string;
		name: string;
		type: AssetTypeKey;
		currency: string;
		balance: number;
		closedAt: Date;
	}[];
};

export type WealthInput = {
	home: string;
	today: string;
	dashboard: DashboardInput;
	/** wealth.getRunwayStats: average monthly spending in the home currency. */
	averageMonthlySpend: number | null;
	rateTypes: Record<string, string[]>;
	ratesUpdated: string | null;
	hideAmounts: boolean;
};

const GROUP_ORDER: GroupKey[] = [
	"cash",
	"investments",
	"crypto",
	"property",
	"liabilities",
];

const TYPE_INFO: Record<AssetTypeKey, { group: GroupKey; kind: AccountKind }> =
	{
		CASH: { group: "cash", kind: "cash" },
		INVESTMENT: { group: "investments", kind: "invest" },
		CRYPTO: { group: "crypto", kind: "crypto" },
		REAL_ESTATE: { group: "property", kind: "property" },
		VEHICLE: { group: "property", kind: "property" },
		LIABILITY_LOAN: { group: "liabilities", kind: "liability" },
		LIABILITY_CREDIT_CARD: { group: "liabilities", kind: "liability" },
		LIABILITY_MORTGAGE: { group: "liabilities", kind: "liability" },
	};

const DAYS: Record<WealthRange, number> = {
	"1M": 30,
	"3M": 91,
	"6M": 182,
	"1Y": 365,
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function daysBefore(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - days);
	return isoDay(d);
}

/**
 * One account as a row. A liability reads negative whatever sign it was
 * stored with (the e2e seed stores it negative, the forms positive).
 */
function account(
	a: DashboardInput["assets"][number],
	input: WealthInput,
): WealthAccount {
	const info = TYPE_INFO[a.type];
	const liability = info.group === "liabilities";
	const signed = (m: Money) => (liability ? owing(m) : m);
	const foreign = a.currency !== input.home;
	// The home currency is never converted, so its rate types do not apply.
	const types = foreign ? (input.rateTypes[a.currency] ?? []) : [];
	return {
		id: a.id,
		name: a.name,
		type: a.type,
		kind: info.kind,
		group: info.group,
		amount: signed(moneyFromMajor(a.balance, a.currency)),
		storedSign: a.balance < 0 ? -1 : 1,
		home: !foreign
			? undefined
			: a.rateMissing
				? null
				: signed(moneyFromMajor(a.balanceInTargetCurrency, input.home)),
		liquid: a.isLiquid && !liability,
		rateType: types.length > 1 ? a.exchangeRateType : null,
		rateTypes: types,
		apr: liability ? a.interestRate : null,
		updated: isoDay(a.updatedAt),
		closedOn: null,
	};
}

/** The home value that counts in totals: the amount itself at home, nothing without a rate. */
function counted(a: WealthAccount): Money | null {
	return a.home === undefined ? a.amount : a.home;
}

function groups(accounts: WealthAccount[], home: string): WealthGroup[] {
	return GROUP_ORDER.flatMap((key) => {
		const rows = accounts.filter((a) => a.group === key);
		if (!rows.length) return [];
		const values = rows.flatMap((a) => counted(a) ?? []);
		return [{ key, total: sumMoney(values, home), accounts: rows }];
	});
}

/** Totals per key over the counted assets (liabilities left out), largest first. */
function shares(
	assets: WealthAccount[],
	keyOf: (a: WealthAccount) => string,
	home: string,
	withSeries: boolean,
): WealthShare[] {
	const byKey = new Map<string, Money[]>();
	for (const a of assets) {
		const v = counted(a);
		if (v) byKey.set(keyOf(a), [...(byKey.get(keyOf(a)) ?? []), v]);
	}
	const whole = sumMoney(
		assets.flatMap((a) => counted(a) ?? []),
		home,
	);
	return [...byKey.entries()]
		.map(([key, list]) => ({ key, value: sumMoney(list, home) }))
		.filter((s) => s.value.minor > 0)
		.sort((x, y) => y.value.minor - x.value.minor)
		.map((s, i) => ({
			...s,
			share: shareOf(s.value, whole),
			...(withSeries ? { series: i + 1 } : {}),
		}));
}

/**
 * The points inside each range. The value at the range's first day is the
 * last snapshot before it (balances hold until the next update), so a range
 * with one update inside still draws a line.
 */
function series(
	history: DashboardInput["history"],
	today: string,
	home: string,
): Record<WealthRange, WealthPoint[]> {
	const points = history.map((h) => ({
		date: h.date,
		value: moneyFromMajor(h.amount, home),
	}));
	const out = {} as Record<WealthRange, WealthPoint[]>;
	for (const range of RANGES) {
		const from = daysBefore(today, DAYS[range]);
		const inside = points.filter((p) => p.date >= from);
		const before = points.filter((p) => p.date < from).at(-1);
		out[range] =
			before && inside[0]?.date !== from
				? [{ date: from, value: before.value }, ...inside]
				: inside;
	}
	return out;
}

function change30(
	netWorth: Money,
	ago: number | null,
	home: string,
): WealthView["change30"] {
	if (ago == null) return null;
	const before = moneyFromMajor(ago, home);
	const amount = subtractMoney(netWorth, before);
	if (before.minor === 0) return { amount, basis: null };
	const ratio =
		(BigInt(amount.minor) * 20000n) / BigInt(Math.abs(before.minor));
	const basis = Number(ratio >= 0n ? (ratio + 1n) / 2n : (ratio - 1n) / 2n);
	return { amount, basis };
}

function runway(liquid: Money, monthly: number | null, home: string) {
	if (!monthly || monthly <= 0 || liquid.minor <= 0) return null;
	const perMonth = moneyFromMajor(monthly, home);
	if (perMonth.minor <= 0) return null;
	// A count of months, one decimal: not money, so plain division is fine.
	const months = Math.round((liquid.minor / perMonth.minor) * 10) / 10;
	return { months, monthly: perMonth };
}

/** Builds the page's view from today's procedures, all money as Money DTOs. */
export function buildWealthView(input: WealthInput): WealthView {
	const { home, dashboard: d } = input;
	const open = d.assets.map((a) => account(a, input));
	const assets = open.filter((a) => a.group !== "liabilities");
	const netWorth = moneyFromMajor(d.totalNetWorth, home);
	const liquid = moneyFromMajor(d.totalLiquidAssets, home);
	const byType = shares(assets, (a) => a.group, home, true);
	return {
		home,
		today: input.today,
		netWorth,
		change30: change30(netWorth, d.netWorth30DaysAgo, home),
		series: series(d.history, input.today, home),
		groups: groups(open, home),
		closed: d.closedAssets.map((c) => {
			const info = TYPE_INFO[c.type];
			const amount = moneyFromMajor(c.balance, c.currency);
			return {
				id: c.id,
				name: c.name,
				type: c.type,
				kind: info.kind,
				group: info.group,
				amount: info.group === "liabilities" ? owing(amount) : amount,
				storedSign: c.balance < 0 ? -1 : 1,
				liquid: false,
				rateType: null,
				rateTypes: input.rateTypes[c.currency] ?? [],
				apr: null,
				updated: isoDay(c.closedAt),
				closedOn: isoDay(c.closedAt),
			};
		}),
		liquid,
		runway: runway(liquid, input.averageMonthlySpend, home),
		allocation: byType,
		breakdown: {
			byType,
			byCurrency: shares(assets, (a) => a.amount.currency, home, false),
			byLiquidity: shares(
				assets,
				(a) => (a.liquid ? "liquid" : "illiquid"),
				home,
				false,
			),
		},
		missingRates: open.filter((a) => a.home === null).length,
		ratesUpdated: input.ratesUpdated,
		hideAmounts: input.hideAmounts,
		rateTypes: input.rateTypes,
	};
}
