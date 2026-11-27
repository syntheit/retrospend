/**
 * account.updateBalance on the device: updateBalanceIn
 * (src/server/services/accounts/update-balance.mutation.ts) over the store,
 * today's balance as typed with its Not logged leg; a new rate type is a
 * dated switch from today. The leg, the account's columns and the snapshot
 * are the domain's checkpointPlan (account-checkpoint-local.ts); the rate and
 * the day rule are the domain's too.
 *
 * - The day is the person's today in their zone, like every leg, so a
 *   checkpoint and a move made the same morning share a day.
 * - An update that changes nothing (the balance already right, the type kept)
 *   writes the day's snapshot and nothing else, as the server does.
 * - A zero balance needs no rate for a leg (there is none); a difference with
 *   no rate is MissingRateError, never booked at 1.
 */
import { updateBalanceSchema } from "@retrospend/api-contract/accounts";
import { moveDay } from "@retrospend/domain/accounts/move-day";
import { balanceFieldsRefusal } from "@retrospend/domain/accounts/refusals";
import {
	resolveAccountRate,
	usdKeepsRateType,
} from "@retrospend/domain/accounts/resolve-rate";
import { dec } from "@retrospend/domain/precise-decimal";
import { type Checkpoint, writeCheckpointIn } from "./account-checkpoint-local";
import {
	findAccount,
	findRateOf,
	type Moment,
	openAccount,
	refuse,
	refuseBadBody,
	refusingAccount,
	zoneOf,
} from "./account-kit";
import { switchRateIn } from "./account-rate-local";
import type { AccountRow, RateSwitchRow } from "./accounts";
import type { WriteFn } from "./local-db";

export const ACCOUNT_UPDATE_BALANCE = "account.updateBalance";

export interface UpdateBalanceInput extends Moment {
	readonly accountId: string;
	/** The balance as typed: what you hold, or what you owe on a liability. */
	readonly balance: string;
	/** A new rate type switches it from today. */
	readonly rateType?: string | null;
	/** The rate as typed, for the custom type. */
	readonly exchangeRate?: string | null;
	/** Client-made ids for the rows the update writes; each is used only when that row is written. */
	readonly legId: string;
	readonly rateTypeId: string;
}

export interface BalanceUpdate extends Checkpoint {
	readonly account: AccountRow;
	readonly rateSwitch: RateSwitchRow | null;
	/** The account's stored rate before the update. */
	readonly previousRate: string | null;
}

export function updateBalance(
	input: UpdateBalanceInput,
): WriteFn<BalanceUpdate> {
	return (r) =>
		refusingAccount(async () => {
			const zone = zoneOf(r, input);
			// The body's shape first, then the typed numbers against the account's
			// currency before it is checked for being open, as the v1 route reads it.
			refuseBadBody(updateBalanceSchema, {
				...input,
				id: input.accountId,
			});
			refuse(
				balanceFieldsRefusal({
					currency: findAccount(r, input.accountId).currency,
					balance: input.balance,
					exchangeRate: input.exchangeRate,
				}),
			);
			const account = openAccount(r, input.accountId);
			const today = moveDay(null, input.now, zone);
			// Today's rate of the account's (new) type; a custom rate stays as typed.
			const wanted =
				input.rateType !== undefined
					? input.rateType
					: account.exchangeRateType;
			const resolved = await resolveAccountRate(
				account.currency,
				today,
				{ rate: input.exchangeRate ?? account.exchangeRate, type: wanted },
				findRateOf(r),
			);
			const rate = usdKeepsRateType(account.currency, resolved, wanted);
			// The switch records the type the account ends up with, which is the
			// resolved one (a type with no rate today falls back), never the request.
			const rateSwitch =
				rate.rateType !== account.exchangeRateType
					? await switchRateIn(r, {
							accountId: account.id,
							rateTypeId: input.rateTypeId,
							rateType: rate.rateType,
							from: today.toISOString().slice(0, 10),
							now: input.now,
							zone,
						})
					: null;
			const checkpoint = writeCheckpointIn(r, openAccount(r, account.id), {
				balance: dec(input.balance),
				rate,
				day: today,
				now: input.now,
				legId: input.legId,
			});
			return {
				...checkpoint,
				account: openAccount(r, account.id),
				rateSwitch,
				previousRate: account.exchangeRate,
			};
		});
}
