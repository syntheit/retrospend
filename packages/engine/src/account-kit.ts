/**
 * What the device's account writes share (account-write-local.ts and its
 * siblings): the refusals as the port's errors, the account reads every write
 * starts with, the rate lookups over the store, and the two writes that keep
 * the rules in one place on the device, the account row (its version) and
 * the day's snapshot.
 *
 * The rules themselves are the domain's (accounts/refusals, resolve-rate,
 * checkpoint-plan, snapshot-plan, rate-switch-plan); the server's writers
 * (src/server/services/accounts/) call the same ones.
 */
import {
	ACCOUNT_CLOSED,
	ACCOUNT_NOT_FOUND,
	AccountRefusal,
	ASSET_NOT_FOUND,
	excessDecimals,
} from "@retrospend/domain/accounts/refusals";
import {
	type FindAccountRate,
	NoRateFoundError,
} from "@retrospend/domain/accounts/resolve-rate";
import type { SnapshotPlan } from "@retrospend/domain/accounts/snapshot-plan";
import {
	MissingRateError,
	rateLookup,
	rateRowsByCurrency,
} from "@retrospend/domain/money";
import { withLocalVersion } from "./account-version";
import type { AccountRow } from "./accounts";
import { NotFoundError } from "./errors";
import { rateBookOf } from "./expense-create";
import { InvalidInputError } from "./port";
import type { Repos } from "./repos";

/** The instant a write runs at and the zone its days are read in (the saved zone when absent). */
export interface Moment {
	readonly now: Date;
	readonly zone?: string;
}

export const zoneOf = (r: Repos, moment: Moment): string =>
	moment.zone ?? r.settings.require().timeZone;

/**
 * The domain's refusals as the port's errors, with the domain's words. A
 * rate the table and the person's typed one both lack is a MissingRateError:
 * the device cannot book it and the server decides (the M2a unbooked rule),
 * never a booking at 1.
 */
export async function refusingAccount<T>(
	run: () => T | Promise<T>,
): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof AccountRefusal)
			throw e.kind === "notFound"
				? new NotFoundError(e.message)
				: new InvalidInputError(e.message);
		if (e instanceof NoRateFoundError) throw new MissingRateError(e.currency);
		throw e;
	}
}

export const refuse = (message: string | null) => {
	if (message !== null) throw new AccountRefusal("badRequest", message);
};

/** An amount the person typed with more decimals than the currency has: refused, never rounded (the v1 transport's check). */
export const refuseExcessDecimals = (
	text: string | null | undefined,
	currency: string,
	field: string,
) => refuse(excessDecimals(text, currency, field));

/** An account of the person, open or closed. */
export function findAccount(r: Repos, id: string): AccountRow {
	const found = r.accounts.get(id)?.account;
	if (!found) throw new AccountRefusal("notFound", ACCOUNT_NOT_FOUND);
	return found;
}

/** An open account of the person; a closed one is refused with "Reopen it to change it". */
export function openAccount(r: Repos, id: string): AccountRow {
	const found = findAccount(r, id);
	if (found.closedAt) throw new AccountRefusal("badRequest", ACCOUNT_CLOSED);
	return found;
}

/** An account of the person, open or closed (close and reopen say "Asset" for one that is missing). */
export function ownAccount(r: Repos, id: string): AccountRow {
	const found = r.accounts.get(id)?.account;
	if (!found) throw new AccountRefusal("notFound", ASSET_NOT_FOUND);
	return found;
}

/** The best table rate of a currency on a day, over the same window of rows the server's lookup sees. */
export const findRateOf = (r: Repos): FindAccountRate => {
	const { find } = rateBookOf(r);
	return (currency, date, preferred) => find(currency, date, preferred ?? null);
};

/** A rate lookup over every stored row of `currencies`, as the server's batch lookup (ratePickFor) reads them. */
export const pickOf = (r: Repos, currencies: Iterable<string>) =>
	rateLookup(rateRowsByCurrency(r.rates.list(), currencies));

/**
 * Writes the account row an update produced. The version moves the way the
 * server's trigger moves it for this one statement (a placeholder until the
 * server's answer names it; account-version.ts).
 */
export function putAccount(r: Repos, next: AccountRow): AccountRow {
	const before = r.accounts.get(next.id)?.account;
	if (!before) throw new NotFoundError(`accounts ${next.id} does not exist`);
	const row = withLocalVersion(before, next);
	r.accounts.updateAccount(row);
	return row;
}

/** The id a device snapshot is made with; a pulled row of the same day keeps the server's. */
const snapshotId = (accountId: string, day: Date) =>
	`${accountId}:${day.toISOString().slice(0, 10)}`;

/**
 * The day's snapshot (one per account per day, the server's upsert). The
 * server also appends a history row; nothing on a device reads it, so none
 * is kept (slice-device-wealth.md, Revision 2 item 7).
 */
export function writeSnapshot(
	r: Repos,
	accountId: string,
	plan: SnapshotPlan,
): void {
	r.accounts.putSnapshot({
		id: snapshotId(accountId, plan.day),
		accountId,
		date: plan.day,
		recordedAt: plan.row.recordedAt,
		balance: plan.row.balance,
		currency: plan.row.currency,
		exchangeRateType: plan.row.exchangeRateType,
	});
}
