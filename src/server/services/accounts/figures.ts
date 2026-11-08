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
 *
 * This file is the server loader: it reads rows with SQL and hands them to
 * the pure compute in @retrospend/domain/accounts/account-figures, which a
 * device runs over its own rows. Owed to you and You owe stay server-computed
 * (payments/figures.ts) and enter as a reading.
 */
import {
	accountBalancesFrom,
	CHANGE_DAYS,
	CHANGE_PARTS,
	type NetWorthInputs,
	netWorthChangeFrom,
	netWorthFrom,
	notTrackedFrom,
} from "@retrospend/domain/accounts/account-figures";
import type {
	ChangePart,
	NetWorthChange,
} from "@retrospend/domain/accounts/net-worth-change";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
	Money,
} from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { owedOnce } from "~/server/services/payments/figures";
import { homeCurrencyOf, ratePickFor } from "./ledger";
import { loadAccountRows, loadAccountsLedger } from "./load";

export { CHANGE_DAYS };

/** Not tracked units per currency, summed over the legs with no account. */
async function notTrackedUnits(db: FigureDb, userId: string) {
	const rows = await db.accountLeg.groupBy({
		by: ["currency"],
		where: { userId, accountId: null },
		_sum: { amount: true },
	});
	return rows.map((r) => ({
		currency: r.currency,
		units: (r._sum.amount ?? "0").toString(),
	}));
}

/**
 * The server loader of net worth: open accounts, Not tracked grouped in SQL,
 * one rate lookup for every currency they need, and Owed to you and You owe
 * from the shared owed reading (loaded once per pass with owed.*).
 */
export async function loadNetWorthInputs(
	db: FigureDb,
	userId: string,
	pass?: FigurePass,
): Promise<NetWorthInputs> {
	const home = await homeCurrencyOf(db, userId);
	const accounts = await loadAccountRows(db, userId, { closedAt: null });
	const notTracked = await notTrackedUnits(db, userId);
	const pick = await ratePickFor(db, [
		home,
		...accounts.map((a) => a.currency),
		...notTracked.map((u) => u.currency),
	]);
	const owed = await owedOnce(db, userId, pass);
	return {
		home,
		accounts,
		notTracked,
		pick,
		owed:
			owed instanceof FigureUnavailable
				? { missingRates: owed.missingRates }
				: { owedToYou: owed.owedToYou, youOwe: owed.youOwe },
	};
}

/**
 * Net worth today in the home currency, or every currency whose missing
 * rate keeps it out (accounts, Not tracked and people, named, R14).
 */
export async function netWorthFor(
	db: FigureDb,
	userId: string,
	pass?: FigurePass,
	now = new Date(),
): Promise<Money | FigureUnavailable> {
	const reading = netWorthFrom(await loadNetWorthInputs(db, userId, pass), now);
	return reading.value ?? new FigureUnavailable(reading.missingRates);
}

/** The breakdown of the last `days` days, ending today (UTC day, as Wealth's history). */
export async function netWorthChangeFor(
	db: FigureDb,
	userId: string,
	days = CHANGE_DAYS,
	now = new Date(),
): Promise<NetWorthChange | null> {
	return netWorthChangeFrom(await loadAccountsLedger(db, userId), now, days);
}

export const netWorthFigure: FigureDefinition = {
	id: "netWorth",
	scope: [],
	compute: (db, scope, pass) => netWorthFor(db, scope.userId, pass),
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
		accountBalancesFrom(
			await loadAccountRows(
				db,
				scope.userId,
				scope.accountId ? { id: scope.accountId } : { closedAt: null },
			),
			scope.accountId,
		),
};

export const notTrackedFigure: FigureDefinition = {
	id: "notTracked",
	scope: [],
	compute: async (db, scope) =>
		notTrackedFrom(await notTrackedUnits(db, scope.userId)),
};

export const accountFigures: FigureDefinition[] = [
	netWorthFigure,
	...netWorthChangeFigures,
	accountsBalanceFigure,
	notTrackedFigure,
];
