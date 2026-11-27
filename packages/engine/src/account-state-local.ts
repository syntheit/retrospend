/**
 * account.close and account.reopen on the device: closeAccountIn and
 * reopenAccountIn (src/server/services/accounts/manage.ts) over the store. A
 * closed account leaves today's totals and counts 0 in the history from the
 * closing day; its balance stays on the account so reopening brings it back.
 *
 * - Closing a closed account and reopening an open one succeed with nothing
 *   written, as the server answers them.
 * - Both date their snapshot by the UTC day, not the person's zone: the rule
 *   the domain keeps for these two paths (snapshotDay "utc", an owner
 *   question in slice-device-wealth.md).
 * - Reopening a balance that is not zero needs a rate to value it; with none
 *   the write is a MissingRateError and writes nothing, never a USD value of 0.
 */
import { accountStateParamsSchema } from "@retrospend/api-contract/accounts";
import {
	reopenRate,
	resolveAccountRate,
} from "@retrospend/domain/accounts/resolve-rate";
import {
	snapshotDay,
	snapshotPlan,
} from "@retrospend/domain/accounts/snapshot-plan";
import { toUSDDec } from "@retrospend/domain/money-dec";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	findRateOf,
	ownAccount,
	putAccount,
	refuseBadBody,
	refusingAccount,
	writeSnapshot,
} from "./account-kit";
import type { AccountRow } from "./accounts";
import type { WriteFn } from "./local-db";

export const ACCOUNT_CLOSE = "account.close";
export const ACCOUNT_REOPEN = "account.reopen";

export interface AccountStateInput {
	readonly id: string;
	readonly now: Date;
}

const metaOf = (a: AccountRow) => ({
	currency: a.currency,
	type: a.type,
	exchangeRateType: a.exchangeRateType,
});

export function closeAccount(input: AccountStateInput): WriteFn<AccountRow> {
	return (r) =>
		refusingAccount(() => {
			refuseBadBody(accountStateParamsSchema, input);
			const asset = ownAccount(r, input.id);
			if (asset.closedAt) return asset;
			const closed = putAccount(r, {
				...asset,
				closedAt: new Date(input.now.getTime()),
			});
			// A zero point on the closing day, so the chart drops there.
			writeSnapshot(
				r,
				asset.id,
				snapshotPlan({
					day: snapshotDay({ rule: "utc", now: input.now }),
					units: 0,
					usd: 0,
					meta: metaOf(asset),
					recordedAt: input.now,
				}),
			);
			return closed;
		});
}

export function reopenAccount(input: AccountStateInput): WriteFn<AccountRow> {
	return (r) =>
		refusingAccount(async () => {
			refuseBadBody(accountStateParamsSchema, input);
			const today = snapshotDay({ rule: "utc", now: input.now });
			const asset = ownAccount(r, input.id);
			if (!asset.closedAt) return asset;
			const balance = dec(asset.balance);
			const balanceInUSD = balance.isZero()
				? "0.00"
				: toUSDDec(
						balance,
						asset.currency,
						await reopenRate(
							() =>
								resolveAccountRate(
									asset.currency,
									today,
									{ rate: asset.exchangeRate, type: asset.exchangeRateType },
									findRateOf(r),
								),
							asset,
						),
					);
			const reopened = putAccount(r, { ...asset, closedAt: null });
			writeSnapshot(
				r,
				asset.id,
				snapshotPlan({
					day: today,
					units: balance,
					usd: balanceInUSD,
					meta: metaOf(asset),
					recordedAt: input.now,
				}),
			);
			return reopened;
		});
}
