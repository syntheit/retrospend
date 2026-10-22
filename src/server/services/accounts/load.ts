/**
 * Loads what the account figures read: every account of the user (closed
 * ones keep their past), its balance updates, legs and rate type switches,
 * Not tracked per currency, and one rate lookup for all their currencies.
 * Reads only through the given client, so a preview sees its own rows.
 */
import { dec } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";
import { homeCurrencyOf, ratePickFor } from "./ledger";
import type { NotTrackedHistory } from "./net-worth-change";
import type { AccountHistory, LegFacts } from "./series";
import type { RatePick } from "./valuation";

type Db = Prisma.TransactionClient;

export interface AccountsLedger {
	readonly homeCurrency: string;
	readonly histories: readonly AccountHistory[];
	readonly notTracked: readonly NotTrackedHistory[];
	readonly pick: RatePick;
}

const LEG_SELECT = {
	id: true,
	accountId: true,
	currency: true,
	date: true,
	createdAt: true,
	amount: true,
	source: true,
	homeAmount: true,
	homeCurrency: true,
} as const satisfies Prisma.AccountLegSelect;

type LegRow = Prisma.AccountLegGetPayload<{ select: typeof LEG_SELECT }>;

const legFacts = (l: LegRow): LegFacts => ({
	id: l.id,
	date: l.date,
	createdAt: l.createdAt,
	amount: dec(l.amount.toString()),
	source: l.source,
	homeAmount: l.homeAmount === null ? null : dec(l.homeAmount.toString()),
	homeCurrency: l.homeCurrency,
});

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
	const out = new Map<K, T[]>();
	for (const row of rows) {
		const k = key(row);
		out.set(k, [...(out.get(k) ?? []), row]);
	}
	return out;
}

export async function loadAccountsLedger(
	db: Db,
	userId: string,
): Promise<AccountsLedger> {
	const homeCurrency = await homeCurrencyOf(db, userId);
	const accounts = await db.assetAccount.findMany({
		where: { userId },
		orderBy: { createdAt: "asc" },
	});
	const snapshots = await db.assetSnapshot.findMany({
		where: { userId },
		orderBy: [{ date: "asc" }, { recordedAt: "asc" }],
	});
	const legs = await db.accountLeg.findMany({
		where: { userId },
		select: LEG_SELECT,
		orderBy: [{ date: "asc" }, { createdAt: "asc" }],
	});
	const rateTypes = await db.assetRateType.findMany({
		where: { userId },
		orderBy: { from: "asc" },
	});
	const snapshotsOf = groupBy(snapshots, (s) => s.accountId);
	const legsOf = groupBy(legs, (l) => l.accountId);
	const typesOf = groupBy(rateTypes, (r) => r.accountId);

	const histories: AccountHistory[] = accounts.map((a) => ({
		account: {
			id: a.id,
			type: a.type,
			currency: a.currency,
			exchangeRateType: a.exchangeRateType,
			exchangeRate:
				a.exchangeRate === null ? null : dec(a.exchangeRate.toString()),
			closedAt: a.closedAt,
		},
		checkpoints: (snapshotsOf.get(a.id) ?? []).map((s) => ({
			date: s.date,
			recordedAt: s.recordedAt,
			balance: dec(s.balance.toString()),
			currency: s.currency,
			exchangeRateType: s.exchangeRateType,
		})),
		legs: (legsOf.get(a.id) ?? []).map(legFacts),
		rateTypes: (typesOf.get(a.id) ?? []).map((r) => ({
			from: r.from,
			type: r.type,
		})),
	}));
	const untracked = groupBy(legsOf.get(null) ?? [], (l) => l.currency);
	const notTracked = [...untracked].map(([currency, rows]) => ({
		currency,
		legs: rows.map(legFacts),
	}));
	const pick = await ratePickFor(db, [
		homeCurrency,
		...accounts.map((a) => a.currency),
		...snapshots.flatMap((s) => (s.currency ? [s.currency] : [])),
		...untracked.keys(),
	]);
	return { homeCurrency, histories, notTracked, pick };
}
