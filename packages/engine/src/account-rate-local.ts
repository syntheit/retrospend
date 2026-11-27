/**
 * account.setRateType on the device (D3): an account is valued at one rate
 * type at a time, switched from a day on. The chain of dated switches is the
 * domain's rateSwitchPlan; this writes its rows. The server also reads the
 * account's value on that day before and after to answer with a revaluation;
 * the device never shows its own figure, so it does not.
 */

import { setRateTypeSchema } from "@retrospend/api-contract/accounts";
import { moveDay } from "@retrospend/domain/accounts/move-day";
import { rateSwitchPlan } from "@retrospend/domain/accounts/rate-switch-plan";
import {
	type Moment,
	openAccount,
	putAccount,
	refuseBadBody,
	refusingAccount,
	zoneOf,
} from "./account-kit";
import type { RateSwitchRow } from "./accounts";
import type { WriteFn } from "./local-db";
import type { Repos } from "./repos";

export const ACCOUNT_SET_RATE_TYPE = "account.setRateType";

export interface SetRateTypeInput extends Moment {
	readonly accountId: string;
	/** The switch row's client-made id; a taken one is refused. */
	readonly rateTypeId: string;
	/** official, blue, mep, card...; null is the default pick. */
	readonly rateType: string | null;
	/** YYYY-MM-DD the type applies from, never in the future; today when absent. */
	readonly from?: string | null;
}

/** Writes the dated switch and, when it is the latest, the account's type. */
export async function switchRateIn(
	r: Repos,
	input: SetRateTypeInput,
): Promise<RateSwitchRow> {
	const account = openAccount(r, input.accountId);
	const from = moveDay(input.from, input.now, zoneOf(r, input));
	const plan = rateSwitchPlan({
		rows: r.accounts.rateSwitches(account.id),
		current: account.exchangeRateType,
		from,
		rateType: input.rateType,
	});
	const row: RateSwitchRow = {
		id: input.rateTypeId,
		accountId: account.id,
		...plan.insert,
		createdAt: new Date(input.now.getTime()),
	};
	r.accounts.addRateSwitch(row);
	if (plan.repoint) {
		const next = r.accounts
			.rateSwitches(account.id)
			.find((s) => s.id === plan.repoint?.id);
		if (next)
			r.accounts.updateRateSwitch({
				...next,
				previousType: plan.repoint.previousType,
			});
	}
	// moveDay never returns a future day, so the latest switch is in force today.
	if (plan.accountRateType)
		putAccount(r, {
			...account,
			exchangeRateType: plan.accountRateType.value,
		});
	return row;
}

/** The write function for a rate type switch; pass it to LocalDb.write or LocalDb.preview. */
export function setRateType(input: SetRateTypeInput): WriteFn<RateSwitchRow> {
	return (r) =>
		refusingAccount(() => {
			refuseBadBody(setRateTypeSchema, { ...input, id: input.accountId });
			return switchRateIn(r, input);
		});
}
