/**
 * Account set-up that moves no money between places: create, edit, close,
 * reopen, delete, export and import (moved out of routers/wealth.ts). A
 * balance typed by hand goes through writeCheckpoint, so it records its Not
 * logged difference like Update balance.
 */
import { TRPCError } from "@trpc/server";
import { generateCsv } from "~/lib/csv";
import { normalizeDate } from "~/lib/date";
import { isValidRate, toUSD, USD } from "~/lib/money";
import { toNumberOrNull } from "~/lib/utils";
import { userTransaction } from "~/server/db-tx";
import { dec } from "~/server/services/envelope/units";
import { WealthService } from "~/server/services/wealth.service";
import type { AssetType, Prisma, PrismaClient } from "~prisma";
import { writeCheckpoint } from "./checkpoint";
import { homeCurrencyOf, lockOpenAccount } from "./ledger";
import { switchRateType } from "./rate-type.mutation";

type Db = PrismaClient;

export interface AccountFields {
	readonly name: string;
	readonly type: AssetType;
	readonly currency: string;
	readonly balance: number;
	readonly exchangeRate?: number;
	readonly exchangeRateType?: string;
	readonly isLiquid: boolean;
	readonly interestRate?: number | null;
	readonly minimumPayment?: number | null;
	readonly dueDate?: number | null;
	/** "Part of my budget"; omitted = the default for its kind and currency. */
	readonly inBudget?: boolean | null;
}

/** The rate stored on an account; a USD account keeps its type, which values the home side (D3). */
async function accountRate(
	service: WealthService,
	fields: Pick<AccountFields, "currency" | "exchangeRate" | "exchangeRateType">,
	date: Date,
) {
	const resolved = await service.resolveExchangeRate(fields.currency, date, {
		rate: fields.exchangeRate,
		type: fields.exchangeRateType,
	});
	return fields.currency === USD
		? { ...resolved, rateType: fields.exchangeRateType ?? null }
		: resolved;
}

const otherFields = (input: AccountFields) => ({
	name: input.name,
	type: input.type,
	currency: input.currency,
	isLiquid: input.isLiquid,
	interestRate: input.interestRate,
	minimumPayment: input.minimumPayment,
	dueDate: input.dueDate,
	...(input.inBudget !== undefined ? { inBudget: input.inBudget } : {}),
});

export async function createAccount(
	db: Db,
	userId: string,
	input: AccountFields,
) {
	const today = normalizeDate(new Date());
	const service = new WealthService(db);
	const { rate, rateType } = await accountRate(service, input, today);
	const balanceInUSD = service.calculateBalanceInUSD(
		input.balance,
		rate,
		input.currency,
	);
	return userTransaction(db, userId, async (tx) => {
		const account = await tx.assetAccount.create({
			data: {
				userId,
				...otherFields(input),
				balance: input.balance,
				exchangeRate: rate,
				exchangeRateType: rateType,
			},
		});
		await service.recordAssetSnapshot(
			tx,
			account.id,
			today,
			input.balance,
			balanceInUSD,
			userId,
			{
				currency: input.currency,
				type: input.type,
				exchangeRateType: rateType,
			},
		);
		return account;
	});
}

/** Edits an open account. A new rate type is a dated switch (D3); a new balance a checkpoint. */
export async function editAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
	input: AccountFields,
) {
	const today = normalizeDate(new Date());
	const existing = await lockOpenAccount(tx, userId, id);
	if (existing.currency !== input.currency) {
		const legs = await tx.accountLeg.count({ where: { accountId: id } });
		if (legs > 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"Money moved through this account in its currency. Add a new account instead.",
			});
		}
	}
	await tx.assetAccount.update({ where: { id }, data: otherFields(input) });
	const rate = await accountRate(new WealthService(tx), input, today);
	if (rate.rateType !== existing.exchangeRateType) {
		await switchRateType(tx, userId, {
			accountId: id,
			rateType: rate.rateType,
		});
	}
	const account = await lockOpenAccount(tx, userId, id);
	await writeCheckpoint(tx, userId, account, {
		balance: dec(String(input.balance)),
		rate,
		date: today,
		homeCurrency: await homeCurrencyOf(tx, userId),
	});
	return tx.assetAccount.findUniqueOrThrow({ where: { id } });
}

export const editAccount = (
	db: Db,
	userId: string,
	id: string,
	input: AccountFields,
) => userTransaction(db, userId, (tx) => editAccountIn(tx, userId, id, input));

async function ownAccount(db: Db, userId: string, id: string) {
	const asset = await db.assetAccount.findFirst({ where: { id, userId } });
	if (!asset) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
	}
	return asset;
}

const snapshotMeta = (asset: {
	currency: string;
	type: AssetType;
	exchangeRateType: string | null;
}) => ({
	currency: asset.currency,
	type: asset.type,
	exchangeRateType: asset.exchangeRateType,
});

/**
 * Closes an account: it leaves today's totals and counts 0 in the history
 * from today on, but its past balances stay. The balance is kept on the
 * account so reopening brings it back.
 */
export async function closeAccount(db: Db, userId: string, id: string) {
	const now = new Date();
	const asset = await ownAccount(db, userId, id);
	if (asset.closedAt) return { success: true };
	const service = new WealthService(db);
	await userTransaction(db, userId, async (tx) => {
		await tx.assetAccount.update({
			where: { id: asset.id },
			data: { closedAt: now },
		});
		// A zero point on the closing day, so the chart drops there.
		await service.recordAssetSnapshot(
			tx,
			asset.id,
			normalizeDate(now),
			0,
			0,
			userId,
			snapshotMeta(asset),
		);
	});
	return { success: true };
}

/**
 * Reopens a closed account with the balance it had. That balance is recorded
 * for today, so the history picks the account up again from the day it was
 * reopened (the closed days stay at 0).
 */
export async function reopenAccount(db: Db, userId: string, id: string) {
	const today = normalizeDate(new Date());
	const asset = await ownAccount(db, userId, id);
	if (!asset.closedAt) return { success: true };
	const service = new WealthService(db);
	const balance = Number(asset.balance);
	const stored = toNumberOrNull(asset.exchangeRate);
	let rate: number | null;
	try {
		({ rate } = await service.resolveExchangeRate(asset.currency, today, {
			rate: stored,
			type: asset.exchangeRateType,
		}));
	} catch {
		// No table rate: the account's own stored rate, if any
		rate = isValidRate(stored) ? stored : null;
	}
	const balanceInUSD = rate === null ? 0 : toUSD(balance, asset.currency, rate);
	await userTransaction(db, userId, async (tx) => {
		await tx.assetAccount.update({
			where: { id: asset.id },
			data: { closedAt: null },
		});
		await service.recordAssetSnapshot(
			tx,
			asset.id,
			today,
			balance,
			balanceInUSD,
			userId,
			snapshotMeta(asset),
		);
	});
	return { success: true };
}

/**
 * Deletes an account and its whole history (snapshots, legs) as if it never
 * existed. Past net worth changes; closing is the way to keep it. A move to
 * or from it keeps its other leg.
 */
export async function deleteAccount(db: Db, userId: string, id: string) {
	const result = await db.assetAccount.deleteMany({ where: { id, userId } });
	if (result.count === 0) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
	}
	return { success: true };
}

/** Open accounts only, like the wealth page; closed ones are in the full data export. */
export async function exportAccountsCsv(db: Db, userId: string) {
	const assets = await db.assetAccount.findMany({
		where: { userId, closedAt: null },
		orderBy: { createdAt: "asc" },
	});
	const service = new WealthService(db);
	const today = new Date();
	const balancesInUSD = await Promise.all(
		assets.map(async (asset) => {
			const stored = toNumberOrNull(asset.exchangeRate);
			try {
				const { rate } = await service.resolveExchangeRate(
					asset.currency,
					today,
					{
						rate: stored,
						type: asset.exchangeRateType,
					},
				);
				return toUSD(Number(asset.balance), asset.currency, rate);
			} catch {
				// No table rate: the asset's own stored rate, else left blank
				return isValidRate(stored)
					? toUSD(Number(asset.balance), asset.currency, stored)
					: null;
			}
		}),
	);
	const header = [
		"name",
		"type",
		"currency",
		"balance",
		"balanceInUSD",
		"exchangeRate",
		"exchangeRateType",
		"isLiquid",
		"createdAt",
		"updatedAt",
	];
	const rows = assets.map((asset, i) => [
		asset.name,
		asset.type,
		asset.currency,
		asset.balance,
		balancesInUSD[i],
		asset.exchangeRate,
		asset.exchangeRateType,
		asset.isLiquid,
		asset.createdAt,
		asset.updatedAt,
	]);
	return { csv: generateCsv(header, rows) };
}

export type ImportRow = Omit<
	AccountFields,
	"exchangeRate" | "exchangeRateType" | "inBudget"
>;

/**
 * Imports accounts by name: an open account with the same name is edited
 * (its new balance is a checkpoint), anything else is created. A closed one
 * keeps its history and a new account is created next to it.
 */
export async function importAccounts(
	db: Db,
	userId: string,
	rows: readonly ImportRow[],
) {
	let successCount = 0;
	let errorCount = 0;
	for (const row of rows) {
		try {
			const existing = await db.assetAccount.findFirst({
				where: { userId, name: row.name, closedAt: null },
			});
			if (existing) await editAccount(db, userId, existing.id, row);
			else await createAccount(db, userId, row);
			successCount++;
		} catch (error) {
			console.error(`Failed to import wealth row ${row.name}:`, error);
			errorCount++;
		}
	}
	return { successCount, errorCount };
}
