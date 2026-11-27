/**
 * A balance typed by hand on the device: the server's writeCheckpoint
 * (src/server/services/accounts/checkpoint.ts), over the store. The rows are
 * the domain's checkpointPlan (the Not logged leg, the account's new columns,
 * the day's snapshot); this writes them in the server's order: the leg first
 * (through the leg writer, so the counted units follow the trigger), then the
 * account's columns, then the snapshot. Update balance and Edit both come
 * here.
 */
import {
	checkpointDifference,
	checkpointPlan,
} from "@retrospend/domain/accounts/checkpoint-plan";
import type { AccountRate } from "@retrospend/domain/accounts/resolve-rate";
import type { Decimal } from "@retrospend/domain/precise-decimal";
import { dec } from "@retrospend/domain/precise-decimal";
import { pickOf, putAccount, writeSnapshot } from "./account-kit";
import { insertLegs } from "./account-legs";
import type { AccountRow } from "./accounts";
import type { Repos } from "./repos";

export interface CheckpointNext {
	readonly balance: Decimal;
	readonly rate: AccountRate;
	/** The stored day (a UTC midnight). */
	readonly day: Date;
	readonly now: Date;
	/** The Not logged leg's client-made id, used only when a leg is written. */
	readonly legId: string;
}

export interface Checkpoint {
	readonly before: string;
	readonly after: string;
	/** The Not logged difference in what you have; "0" when the balance was already right. */
	readonly notLogged: string;
	/** Null when the balance was already right. */
	readonly legId: string | null;
}

export function writeCheckpointIn(
	r: Repos,
	account: AccountRow,
	next: CheckpointNext,
): Checkpoint {
	const homeCurrency = r.settings.require().homeCurrency;
	// Rates are read only when there is a leg to book.
	const pick = checkpointDifference(account, next.balance).isZero()
		? null
		: pickOf(r, [account.currency, homeCurrency]);
	const plan = checkpointPlan({
		account,
		balance: next.balance,
		// The resolved rate is a float; it becomes the decimal it names here.
		rate: { rate: String(next.rate.rate), rateType: next.rate.rateType },
		day: next.day,
		homeCurrency,
		pick,
		recordedAt: next.now,
	});
	if (plan.leg) {
		insertLegs(r.accounts, [
			{
				id: next.legId,
				accountId: account.id,
				currency: plan.leg.currency,
				date: plan.leg.date,
				createdAt: next.now,
				amount: dec(plan.leg.amount).toFixed(),
				source: plan.leg.source,
				homeAmount:
					plan.leg.homeAmount === null
						? null
						: dec(plan.leg.homeAmount).toFixed(),
				homeCurrency: plan.leg.homeCurrency,
				countedUnits: "0",
				transferId: null,
				expenseId: null,
			},
		]);
	}
	// The leg writer may have moved the account; the plan's columns go over what it holds now.
	const now = r.accounts.get(account.id)?.account ?? account;
	putAccount(r, { ...now, ...plan.account });
	writeSnapshot(r, account.id, plan.snapshot);
	return {
		before: plan.before.toString(),
		after: plan.after.toString(),
		notLogged: plan.notLogged.toString(),
		legId: plan.leg ? next.legId : null,
	};
}
