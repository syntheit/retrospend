/**
 * Account figures (IMPLEMENTATION §2.4), registered in
 * src/server/figures/registry.ts:
 * - `netWorth`: open accounts at each one's rate type, plus Not tracked,
 *   plus Owed to you minus You owe (I8: the People number), in the home
 *   currency. Unavailable when any of them has no rate (R14).
 * - `netWorthChange.total` and its parts (`income`, `spending`, `exchange`,
 *   `notLogged`, `revaluation`, `opened`, `closed`): the last 30 days, the
 *   span the Wealth header shows. The parts add up to the total (I10).
 * - `accounts.balance`: per currency, what open accounts hold (liabilities
 *   count against you); narrowed by `accountId`, that one account.
 * - `notTracked`: per currency, the cash side of money moves with no account.
 */
import { normalizeDate } from "~/lib/date";
import type {
	FigureDb,
	FigureDefinition,
	Money,
} from "~/server/figures/registry";
import { dec, toMinor } from "~/server/services/envelope/units";
import { owedFor } from "~/server/services/payments/figures";
import { homeCurrencyOf, ratePickFor } from "./ledger";
import { loadAccountsLedger } from "./load";
import {
	CHANGE_PARTS,
	type ChangePart,
	type NetWorthChange,
	netWorthChange,
} from "./net-worth-change";
import { worthOf } from "./places";
import { addDays, dayOf } from "./series";
import { homeValue } from "./valuation";

/** The span netWorthChange figures cover, in days, ending today. */
export const CHANGE_DAYS = 30;

function sumByCurrency(
	rows: readonly { currency: string; minor: number }[],
): Money[] {
	const totals = new Map<string, bigint>();
	for (const r of rows) {
		totals.set(r.currency, (totals.get(r.currency) ?? 0n) + BigInt(r.minor));
	}
	return [...totals].map(([currency, minor]) => ({
		currency,
		minor: Number(minor),
	}));
}

async function notTrackedUnits(db: FigureDb, userId: string) {
	const rows = await db.accountLeg.groupBy({
		by: ["currency"],
		where: { userId, accountId: null },
		_sum: { amount: true },
	});
	return rows.map((r) => ({
		currency: r.currency,
		units: dec(r._sum.amount?.toString() ?? "0"),
	}));
}

/** Open accounts as Money in their own currencies; liabilities negative. */
async function openAccountMoney(
	db: FigureDb,
	userId: string,
	accountId?: string,
) {
	const accounts = await db.assetAccount.findMany({
		where: accountId ? { userId, id: accountId } : { userId, closedAt: null },
		select: { type: true, currency: true, balance: true },
	});
	return accounts.map((a) => ({
		currency: a.currency,
		minor: toMinor(worthOf(a.type, dec(a.balance.toString())), a.currency),
	}));
}

/** Net worth today in the home currency, or null when a rate is missing. */
export async function netWorthFor(
	db: FigureDb,
	userId: string,
): Promise<Money | null> {
	const home = await homeCurrencyOf(db, userId);
	const accounts = await db.assetAccount.findMany({
		where: { userId, closedAt: null },
		select: {
			type: true,
			currency: true,
			balance: true,
			exchangeRate: true,
			exchangeRateType: true,
		},
	});
	const untracked = await notTrackedUnits(db, userId);
	const pick = await ratePickFor(db, [
		home,
		...accounts.map((a) => a.currency),
		...untracked.map((u) => u.currency),
	]);
	const now = new Date();
	let total = dec(0);
	for (const a of accounts) {
		const value = homeValue(
			pick,
			{
				currency: a.currency,
				rateType: a.exchangeRateType,
				storedRate: a.exchangeRate,
			},
			worthOf(a.type, dec(a.balance.toString())),
			home,
			now,
		);
		if (value === null) return null;
		total = total.add(value);
	}
	for (const u of untracked) {
		const value = homeValue(
			pick,
			{ currency: u.currency, rateType: null, storedRate: null },
			u.units,
			home,
			now,
		);
		if (value === null) return null;
		total = total.add(value);
	}
	// Owed in the same home currency (owedFor reads the same user row).
	const owed = await owedFor(db, userId);
	if (owed === null) return null;
	return {
		minor: toMinor(total, home) + owed.owedToYou - owed.youOwe,
		currency: home,
	};
}

/** The breakdown of the last `days` days, ending today (UTC day, as Wealth's history). */
export async function netWorthChangeFor(
	db: FigureDb,
	userId: string,
	days = CHANGE_DAYS,
): Promise<NetWorthChange | null> {
	const ledger = await loadAccountsLedger(db, userId);
	const today = dayOf(normalizeDate(new Date()));
	// A move is dated in the user's zone, which can be a day ahead of UTC, so
	// the span ends a day later: no move dated today is ever left out.
	return netWorthChange(
		ledger.histories,
		ledger.notTracked,
		{ from: addDays(today, -days), to: addDays(today, 1) },
		ledger.homeCurrency,
		ledger.pick,
	);
}

export const netWorthFigure: FigureDefinition = {
	id: "netWorth",
	scope: [],
	compute: (db, scope) => netWorthFor(db, scope.userId),
};

const changeFigure = (part: ChangePart | "total"): FigureDefinition => ({
	id: `netWorthChange.${part}`,
	scope: [],
	// The total and the seven parts are one breakdown: loaded once per read pass.
	compute: async (db, scope, pass) => {
		const load = () => netWorthChangeFor(db, scope.userId);
		const change = await (pass
			? pass.once(`netWorthChange:${scope.userId}`, load)
			: load());
		if (!change) return null;
		const minor = part === "total" ? change.total : change.parts[part];
		return { minor, currency: change.currency };
	},
});

export const netWorthChangeFigures: FigureDefinition[] = [
	changeFigure("total"),
	...CHANGE_PARTS.map(changeFigure),
];

export const accountsBalanceFigure: FigureDefinition = {
	id: "accounts.balance",
	scope: ["accountId"],
	compute: async (db, scope) =>
		sumByCurrency(await openAccountMoney(db, scope.userId, scope.accountId)),
};

export const notTrackedFigure: FigureDefinition = {
	id: "notTracked",
	scope: [],
	compute: async (db, scope) =>
		(await notTrackedUnits(db, scope.userId))
			.map((u) => ({
				currency: u.currency,
				minor: toMinor(u.units, u.currency),
			}))
			.filter((m) => m.minor !== 0),
};

export const accountFigures: FigureDefinition[] = [
	netWorthFigure,
	...netWorthChangeFigures,
	accountsBalanceFigure,
	notTrackedFigure,
];
