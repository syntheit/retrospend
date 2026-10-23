/**
 * Update balance (MONEY-MOVES §2.1, §4.6): a checkpoint that says what the
 * account holds today. It keeps the sign the user typed (T3-7), writes the
 * difference from the recorded balance as a Not logged leg, and records the
 * day's snapshot like every balance write before legs existed. Every path
 * that sets a balance by hand (Update balance, Edit, import) comes here.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { dec } from "~/server/services/envelope/units";
import { WealthService } from "~/server/services/wealth.service";
import type { Prisma } from "~prisma";
import {
	type AccountChange,
	type AccountRow,
	bookHome,
	ratePickFor,
} from "./ledger";
import { cappedCounted, worthOf } from "./places";

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
	const before = dec(account.balance.toString());
	const notLogged = worthOf(account.type, next.balance.sub(before));
	let legId: string | null = null;
	if (!notLogged.isZero()) {
		const pick = await ratePickFor(tx, [account.currency, next.homeCurrency]);
		const valuedAt = {
			currency: account.currency,
			exchangeRateType: next.rate.rateType,
			exchangeRate: next.rate.rate,
		};
		const home = bookHome(
			pick,
			{ currency: account.currency, account: valuedAt },
			notLogged,
			next.homeCurrency,
			next.date,
		);
		legId = (
			await tx.accountLeg.create({
				data: {
					userId,
					accountId: account.id,
					currency: account.currency,
					amount: notLogged.toString(),
					homeAmount: home?.amount.toString() ?? null,
					homeCurrency: home?.currency ?? null,
					date: next.date,
					source: "BALANCE_UPDATE",
					createdAt: new Date(),
				},
				select: { id: true },
			})
		).id;
	}
	await tx.assetAccount.update({
		where: { id: account.id },
		data: {
			balance: next.balance.toString(),
			countedUnits: cappedCounted(
				account.type,
				dec(account.countedUnits.toString()),
				next.balance,
			).toString(),
			exchangeRate: next.rate.rate,
			exchangeRateType: next.rate.rateType,
		},
	});
	const service = new WealthService(tx);
	await service.recordAssetSnapshot(
		tx,
		account.id,
		next.date,
		next.balance.toNumber(),
		service.calculateBalanceInUSD(
			next.balance.toNumber(),
			next.rate.rate,
			account.currency,
		),
		userId,
		{
			currency: account.currency,
			type: account.type,
			exchangeRateType: next.rate.rateType,
		},
	);
	return {
		change: {
			accountId: account.id,
			name: account.name,
			currency: account.currency,
			before: before.toString(),
			after: next.balance.toString(),
		},
		notLogged: notLogged.toString(),
		legId,
	};
}
