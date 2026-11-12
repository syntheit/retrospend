/**
 * What the Postgres trigger `account_leg_moves_balance` does to an account's
 * stored balance, its balance updates (snapshots) and its counted units when a
 * leg is inserted, updated or deleted, in pure code. The source of truth is
 * `account_leg_apply` (prisma/migrations/20261112100000_account_leg_half_even)
 * and `account_leg_moves_balance`
 * (prisma/migrations/20261024300000_accounts_legs_transfers); the real-Postgres
 * parity test (src/server/services/accounts/apply-legs.parity.pg.test.ts)
 * compares the two on random leg sequences. When the trigger changes, change
 * this with it.
 *
 * The trigger is not idempotent: it moves the balance by the leg each time it
 * fires. Apply each change once, in the order the database saw it.
 *
 * Arithmetic follows Postgres numeric: sums and products are exact, a USD
 * value is rounded to cents half to even (`round_half_even`), and a division
 * keeps the digits Postgres picks (select_div_scale: at least 16 significant
 * digits, never fewer decimals than either side, the last one rounded half
 * away from zero) before it is rounded to cents, so a quotient that lands
 * next to a tie rounds the way the database rounds it.
 */
import { Dec, type Decimal } from "../precise-decimal";

/** Postgres numeric: exact at any size the columns allow; its division rounds ties away from zero. */
const Num = Dec.clone({ precision: 200, rounding: Dec.ROUND_HALF_UP });
const HALF_UP = Dec.ROUND_HALF_UP;
const HALF_EVEN = Dec.ROUND_HALF_EVEN;
const ZERO = new Num(0);

export type AccountLegSource = "INCOME" | "TRANSFER" | "FEE" | "BALANCE_UPDATE";

/** An amount as a decimal string or a Decimal; never a JS number. */
export type LegAmount = string | Decimal;

/** The `account_leg` columns the trigger reads. */
export interface Leg {
	/** Null is Not tracked: the leg moves nothing. */
	accountId: string | null;
	/** Signed in what you have (+ is more money), whatever the account's kind. */
	amount: LegAmount;
	date: Date;
	createdAt: Date;
	source: AccountLegSource;
	/** Units of this leg the budget already counts. */
	countedUnits: LegAmount;
}

/** The `asset_account` columns the trigger reads or writes. */
export interface LegAccount {
	/** `AssetType`; every `LIABILITY_*` stores what you owe. */
	type: string;
	currency: string;
	balance: LegAmount;
	countedUnits: LegAmount;
	/** Units per USD (USD per coin on CRYPTO); only read for a zero snapshot. */
	exchangeRate: LegAmount | null;
}

/** The `asset_snapshot` columns the trigger reads or writes. */
export interface LegSnapshot {
	id: string;
	accountId: string;
	date: Date;
	balance: LegAmount;
	balanceInUSD: LegAmount;
	/** Null on rows older than the column: the account's currency applies. */
	currency: string | null;
	recordedAt: Date;
}

export interface LegState {
	accounts: ReadonlyMap<string, LegAccount>;
	/**
	 * Any order: a leg moves its snapshots oldest first, as the trigger does. A
	 * zero-balance snapshot is valued from the nearest other snapshot that
	 * holds something, and one the same change already moved counts at its new
	 * value, so the order shows in the result. The result keeps this order.
	 */
	snapshots: readonly LegSnapshot[];
}

export type LegChange =
	| { op: "insert"; leg: Leg }
	| { op: "update"; old: Leg; next: Leg }
	| { op: "delete"; leg: Leg };

/** The same state with every amount an exact Decimal. */
interface Work {
	accounts: Map<string, WorkAccount>;
	snapshots: WorkSnapshot[];
}
type WorkAccount = Omit<
	LegAccount,
	"balance" | "countedUnits" | "exchangeRate"
> & {
	balance: Decimal;
	countedUnits: Decimal;
	exchangeRate: Decimal | null;
};
type WorkSnapshot = Omit<LegSnapshot, "balance" | "balanceInUSD"> & {
	balance: Decimal;
	balanceInUSD: Decimal;
};

const BALANCE_LIMIT = new Num("1e11"); // numeric(19,8)
const USD_LIMIT = new Num("1e10"); // numeric(12,2)

function exact(value: LegAmount): Decimal {
	return new Num(value.toString());
}

function isLiability(type: string): boolean {
	return type.startsWith("LIABILITY_");
}

/** Postgres refuses a value its column cannot hold; so does this. */
function fits(value: Decimal, limit: Decimal, column: string): Decimal {
	if (value.abs().gte(limit)) {
		throw new RangeError(`numeric field overflow in ${column}`);
	}
	return value;
}

/** `round_half_even(value, 2)` into numeric(12,2): cents, ties to even. */
function toUsd(value: Decimal): Decimal {
	return fits(
		value.toDecimalPlaces(2, HALF_EVEN).plus(0),
		USD_LIMIT,
		"balanceInUSD",
	);
}

function toBalance(value: Decimal): Decimal {
	return fits(value, BALANCE_LIMIT, "balance");
}

/** Base-10000 weight and leading digit of a numeric, as Postgres stores it. */
function weightAndFirstDigit(x: Decimal): { weight: number; first: Decimal } {
	if (x.isZero()) return { weight: 0, first: ZERO };
	const weight = Math.floor(x.e / 4);
	const first = x
		.abs()
		.div(new Num(10).pow(4 * weight))
		.floor();
	return { weight, first };
}

/**
 * a / b the way Postgres numeric does: the quotient is rounded to the scale
 * select_div_scale picks from the leading digits and the two operands' own
 * scales (`scaleA`, `scaleB`: the decimals the stored values carry).
 */
export function pgDivide(
	a: LegAmount,
	b: LegAmount,
	scaleA: number,
	scaleB: number,
): Decimal {
	const numerator = exact(a);
	const divisor = exact(b);
	const x = weightAndFirstDigit(numerator);
	const y = weightAndFirstDigit(divisor);
	let qweight = x.weight - y.weight;
	if (x.first.lte(y.first)) qweight -= 1;
	const scale = Math.min(Math.max(16 - qweight * 4, scaleA, scaleB, 0), 1000);
	return numerator.div(divisor).toDecimalPlaces(scale, HALF_UP);
}

/**
 * USD per unit of an account for a snapshot whose own balance is 0
 * (`account_usd_per_unit`): the nearest other snapshot that held something
 * (the later one on a tie), else the account's stored rate, else null.
 */
function usdPerUnit(
	work: Work,
	account: WorkAccount,
	snapshot: WorkSnapshot,
): Decimal | null {
	let best: WorkSnapshot | null = null;
	let bestGap = 0;
	for (const other of work.snapshots) {
		if (
			other.accountId !== snapshot.accountId ||
			other.id === snapshot.id ||
			other.balance.isZero()
		) {
			continue;
		}
		const gap = Math.abs(other.date.getTime() - snapshot.date.getTime());
		if (
			best === null ||
			gap < bestGap ||
			(gap === bestGap && other.date.getTime() > best.date.getTime())
		) {
			best = other;
			bestGap = gap;
		}
	}
	if (best) return pgDivide(best.balanceInUSD, best.balance, 2, 8);
	const rate = account.exchangeRate;
	if (rate === null || rate.lte(0)) return null;
	if (account.type === "CRYPTO") return rate;
	return pgDivide("1", rate, 0, 6);
}

/**
 * Snapshot positions oldest first (the trigger's ORDER BY date). An account
 * has one snapshot a day (unique accountId, date), and a leg moves one account.
 */
function byDate(snapshots: readonly WorkSnapshot[]): number[] {
	const time = (i: number) => (snapshots[i] as WorkSnapshot).date.getTime();
	return snapshots.map((_, i) => i).sort((a, b) => time(a) - time(b));
}

/** The snapshot after `effect` moved its account. */
function moveSnapshot(
	work: Work,
	account: WorkAccount,
	snapshot: WorkSnapshot,
	effect: Decimal,
): WorkSnapshot {
	const balance = toBalance(snapshot.balance.plus(effect));
	let usd: Decimal;
	if ((snapshot.currency ?? account.currency) === "USD") {
		usd = toUsd(balance);
	} else if (!snapshot.balance.isZero()) {
		// balanceInUSD * (balance + effect) / balance, left to right.
		usd = toUsd(
			pgDivide(snapshot.balanceInUSD.mul(balance), snapshot.balance, 2 + 8, 8),
		);
	} else {
		const perUnit = usdPerUnit(work, account, snapshot);
		usd = perUnit === null ? snapshot.balanceInUSD : toUsd(effect.mul(perUnit));
	}
	return { ...snapshot, balance, balanceInUSD: usd };
}

/** `account_leg_apply(leg, direction, moves_money)`. */
function applyOne(
	work: Work,
	leg: Leg,
	direction: 1 | -1,
	movesMoney: boolean,
): void {
	if (leg.accountId === null) return;
	const account = work.accounts.get(leg.accountId);
	// The account itself is gone (a cascade): nothing to move.
	if (!account) return;
	if (movesMoney && leg.source !== "BALANCE_UPDATE") {
		const amount = exact(leg.amount);
		const effect = isLiability(account.type)
			? amount.neg().mul(direction)
			: amount.mul(direction);
		const moved = {
			...account,
			balance: toBalance(account.balance.plus(effect)),
		};
		work.accounts.set(leg.accountId, moved);
		for (const i of byDate(work.snapshots)) {
			const snapshot = work.snapshots[i] as WorkSnapshot;
			if (
				snapshot.accountId === leg.accountId &&
				snapshot.date.getTime() >= leg.date.getTime() &&
				snapshot.recordedAt.getTime() >= leg.createdAt.getTime()
			) {
				work.snapshots[i] = moveSnapshot(work, moved, snapshot, effect);
			}
		}
	}
	const counted = exact(leg.countedUnits);
	if (counted.gt(0)) {
		const current = work.accounts.get(leg.accountId) as WorkAccount;
		work.accounts.set(leg.accountId, {
			...current,
			countedUnits: Num.max(
				0,
				current.countedUnits.plus(counted.mul(direction)),
			),
		});
	}
}

/** `account_cap_counted`: an account never counts more than it holds. */
function capCounted(work: Work, accountId: string): void {
	const account = work.accounts.get(accountId);
	if (!account) return;
	const capped = isLiability(account.type)
		? ZERO
		: Num.min(account.countedUnits, Num.max(0, account.balance));
	work.accounts.set(accountId, { ...account, countedUnits: capped });
}

/**
 * `account_leg_moves_balance`: leg changes applied one after another to the
 * accounts and snapshots. An update that keeps where, when and how much (same
 * account, amount, date, createdAt and source) moves no money, only counted
 * units. Returns new state; the input is not changed. A change that would
 * overflow a column throws a RangeError, as Postgres refuses the statement,
 * and the whole call has no effect.
 */
export function applyLegs(
	state: LegState,
	changes: readonly LegChange[],
): LegState {
	const work: Work = {
		accounts: new Map(
			[...state.accounts].map(([id, account]) => [
				id,
				{
					...account,
					balance: exact(account.balance),
					countedUnits: exact(account.countedUnits),
					exchangeRate:
						account.exchangeRate === null ? null : exact(account.exchangeRate),
				},
			]),
		),
		snapshots: state.snapshots.map((snapshot) => ({
			...snapshot,
			balance: exact(snapshot.balance),
			balanceInUSD: exact(snapshot.balanceInUSD),
		})),
	};
	for (const change of changes) {
		const oldLeg =
			change.op === "insert"
				? null
				: change.op === "update"
					? change.old
					: change.leg;
		const newLeg =
			change.op === "delete"
				? null
				: change.op === "update"
					? change.next
					: change.leg;
		let movesMoney = true;
		if (oldLeg && newLeg) {
			movesMoney =
				oldLeg.accountId !== newLeg.accountId ||
				!exact(oldLeg.amount).eq(exact(newLeg.amount)) ||
				oldLeg.date.getTime() !== newLeg.date.getTime() ||
				oldLeg.createdAt.getTime() !== newLeg.createdAt.getTime() ||
				oldLeg.source !== newLeg.source;
		}
		if (oldLeg) applyOne(work, oldLeg, -1, movesMoney);
		if (newLeg) applyOne(work, newLeg, 1, movesMoney);
		// Capped once both sides are applied, so an update never loses units midway.
		if (oldLeg?.accountId) capCounted(work, oldLeg.accountId);
		if (newLeg?.accountId) capCounted(work, newLeg.accountId);
	}
	return { accounts: work.accounts, snapshots: work.snapshots };
}
