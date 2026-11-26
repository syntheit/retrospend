/**
 * Update balance (MONEY-MOVES §2.1, §4.6): a checkpoint that says what the
 * account holds today. It keeps the sign the user typed (T3-7), writes the
 * difference from the recorded balance as a Not logged leg, and records the
 * day's snapshot like every balance write before legs existed. Every path
 * that sets a balance by hand (Update balance, Edit, import) comes here.
 */

import {
	checkpointDifference,
	checkpointPlan,
} from "@retrospend/domain/accounts/checkpoint-plan";
import type { Decimal } from "@retrospend/domain/precise-decimal";
import { WealthService } from "~/server/services/wealth.service";
import type { Prisma } from "~prisma";
import { type AccountChange, type AccountRow, ratePickFor } from "./ledger";

type Tx = Prisma.TransactionClient;

export interface CheckpointRate {
	readonly rate: number;
	readonly rateType: string | null;
}

export interface Checkpoint {
	readonly change: AccountChange;
	/** The Not logged difference in what you have, in the account's currency. */
	readonly notLogged: string;
	/** Null when the balance was already right. */
	readonly legId: string | null;
}

export async function writeCheckpoint(
	tx: Tx,
	userId: string,
	account: AccountRow,
	next: {
		balance: Decimal;
		rate: CheckpointRate;
		date: Date;
		homeCurrency: string;
	},
): Promise<Checkpoint> {
	const typed = { type: account.type, balance: account.balance };
	// Rates are loaded only when there is a leg to book.
	const pick = checkpointDifference(typed, next.balance).isZero()
		? null
		: await ratePickFor(tx, [account.currency, next.homeCurrency]);
	const plan = checkpointPlan({
		account: {
			type: account.type,
			currency: account.currency,
			balance: account.balance,
			countedUnits: account.countedUnits,
		},
		balance: next.balance,
		// The resolved rate is a float; it becomes the decimal it names here.
		rate: { rate: String(next.rate.rate), rateType: next.rate.rateType },
		day: next.date,
		homeCurrency: next.homeCurrency,
		pick,
		recordedAt: new Date(),
	});
	let legId: string | null = null;
	if (plan.leg) {
		legId = (
			await tx.accountLeg.create({
				data: {
					userId,
					accountId: account.id,
					currency: plan.leg.currency,
					amount: plan.leg.amount,
					homeAmount: plan.leg.homeAmount,
					homeCurrency: plan.leg.homeCurrency,
					date: plan.leg.date,
					source: plan.leg.source,
					createdAt: new Date(),
				},
				select: { id: true },
			})
		).id;
	}
	await tx.assetAccount.update({
		where: { id: account.id },
		data: plan.account,
	});
	await new WealthService(tx).writeSnapshotPlan(
		tx,
		account.id,
		userId,
		plan.snapshot,
	);
	return {
		change: {
			accountId: account.id,
			name: account.name,
			currency: account.currency,
			before: plan.before.toString(),
			after: plan.after.toString(),
		},
		notLogged: plan.notLogged.toString(),
		legId,
	};
}
