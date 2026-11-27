/**
 * The device's leg writer: what the server's `account_leg_moves_balance`
 * trigger does when a leg row is inserted, through the one domain owner
 * (applyLegs, held to the trigger by its parity test). The engine never moves
 * a balance, a counted unit or a snapshot by its own arithmetic: it hands the
 * legs to applyLegs and writes back what changed.
 *
 * The device keeps no USD value on a snapshot, so each goes in with a zero
 * one and the USD applyLegs works out is dropped. The balance of a snapshot
 * never depends on it.
 */
import {
	applyLegs,
	type Leg,
	type LegChange,
	type LegSnapshot,
	type LegState,
} from "@retrospend/domain/accounts/apply-legs";
import { dec } from "@retrospend/domain/precise-decimal";
import type { AccountAggregate, LegRow } from "./accounts";
import { NotFoundError } from "./errors";
import type { Repos } from "./repos";

type Accounts = Repos["accounts"];

const NO_USD = "0";

const legOf = (l: LegRow): Leg => ({
	accountId: l.accountId,
	amount: l.amount,
	date: l.date,
	createdAt: l.createdAt,
	source: l.source,
	countedUnits: l.countedUnits,
});

function stateOf(aggregates: readonly AccountAggregate[]): LegState {
	return {
		accounts: new Map(
			aggregates.map(({ account: a }) => [
				a.id,
				{
					type: a.type,
					currency: a.currency,
					balance: a.balance,
					countedUnits: a.countedUnits,
					exchangeRate: a.exchangeRate,
				},
			]),
		),
		snapshots: aggregates.flatMap(({ snapshots }) =>
			snapshots.map(
				(s): LegSnapshot => ({
					id: s.id,
					accountId: s.accountId,
					date: s.date,
					balance: s.balance,
					balanceInUSD: NO_USD,
					currency: s.currency,
					recordedAt: s.recordedAt,
				}),
			),
		),
	};
}

/** The accounts a set of legs touches, as the store holds them; one the store lacks throws NotFoundError before anything is written. */
function aggregatesOf(
	accounts: Accounts,
	legs: readonly LegRow[],
): AccountAggregate[] {
	const ids = [
		...new Set(legs.flatMap((l) => (l.accountId ? [l.accountId] : []))),
	];
	return ids.map((id) => {
		const found = accounts.get(id);
		if (!found) throw new NotFoundError(`accounts ${id} does not exist`);
		return found;
	});
}

/** Writes back the balance, counted units and snapshot balances `next` moved. */
function writeBack(
	accounts: Accounts,
	aggregates: readonly AccountAggregate[],
	next: LegState,
): void {
	for (const { account, snapshots } of aggregates) {
		const moved = next.accounts.get(account.id);
		const balance = moved && dec(moved.balance);
		const counted = moved && dec(moved.countedUnits);
		if (
			balance &&
			counted &&
			(!balance.eq(dec(account.balance)) ||
				!counted.eq(dec(account.countedUnits)))
		)
			accounts.updateAccount({
				...account,
				balance: balance.toFixed(),
				countedUnits: counted.toFixed(),
			});
		for (const snapshot of snapshots) {
			const after = next.snapshots.find((s) => s.id === snapshot.id);
			const moved = after && dec(after.balance);
			if (moved && !moved.eq(dec(snapshot.balance)))
				accounts.putSnapshot({ ...snapshot, balance: moved.toFixed() });
		}
	}
}

/**
 * Inserts `legs` in order, each as the trigger sees it: its account's balance
 * and counted units move, and so does every snapshot of that account the leg
 * reaches. A leg with no account (Not tracked) moves nothing. An account the
 * store does not hold throws NotFoundError before anything is written.
 */
export function insertLegs(accounts: Accounts, legs: readonly LegRow[]): void {
	const aggregates = aggregatesOf(accounts, legs);
	const next = applyLegs(
		stateOf(aggregates),
		legs.map((leg): LegChange => ({ op: "insert", leg: legOf(leg) })),
	);
	for (const leg of legs) accounts.addLeg(leg);
	writeBack(accounts, aggregates, next);
}

/**
 * Takes `legs` away in order, as the trigger sees a delete: the balance, the
 * counted units and the snapshots each one moved go back. The legs are the
 * store's own rows (a transfer's, found by its id).
 */
export function removeLegs(accounts: Accounts, legs: readonly LegRow[]): void {
	const aggregates = aggregatesOf(accounts, legs);
	const next = applyLegs(
		stateOf(aggregates),
		legs.map((leg): LegChange => ({ op: "delete", leg: legOf(leg) })),
	);
	for (const leg of legs) accounts.removeLeg(leg.id);
	writeBack(accounts, aggregates, next);
}
