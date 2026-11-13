/**
 * Account set-up that moves no money between places: create, edit, close,
 * reopen, delete, export and import (moved out of routers/wealth.ts). A
 * balance typed by hand goes through writeCheckpoint, so it records its Not
 * logged difference like Update balance.
 */
import { columnFromFloat } from "@retrospend/domain/money-dec";
import {
	type Decimal,
	type DecimalInput,
	toFloat,
} from "@retrospend/domain/precise-decimal";
import { TRPCError } from "@trpc/server";
import { CsvNumber, generateCsv } from "~/lib/csv";
import { isCrypto } from "@retrospend/domain/currency-format";
import { normalizeDate } from "~/lib/date";
import { hasRate, MissingRateError, USD } from "@retrospend/domain/money-dec";
import { userTransaction } from "~/server/db-tx";
import { deleteFile } from "~/server/storage";
import { dec } from "~/server/services/envelope/units";
import { userTimeZone } from "~/server/services/user-time-zone";
import { WealthService } from "~/server/services/wealth.service";
import type { AssetType, Prisma, PrismaClient } from "~prisma";
import { writeCheckpoint } from "./checkpoint";
import { moveDay } from "./dates";
import { homeCurrencyOf, lockOpenAccount } from "./ledger";
import { isLiability } from "./places";
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

const column = (value: number | null | undefined, scale: number) =>
	value === null || value === undefined
		? value
		: columnFromFloat(value, scale);

const otherFields = (input: AccountFields) => ({
	name: input.name,
	type: input.type,
	currency: input.currency,
	isLiquid: input.isLiquid,
	interestRate: column(input.interestRate, 6),
	minimumPayment: column(input.minimumPayment, 8),
	dueDate: input.dueDate,
	...(input.inBudget !== undefined ? { inBudget: input.inBudget } : {}),
});

/** A balance typed by hand is dated by the user's day, like every leg. */
const checkpointDay = (timeZone: string) =>
	moveDay(null, new Date(), timeZone);

export async function createAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	input: AccountFields & { readonly id?: string },
	timeZone?: string,
) {
	const today = checkpointDay(await userTimeZone(tx, userId, timeZone));
	const service = new WealthService(tx);
	const { rate, rateType } = await accountRate(service, input, today);
	const balance = dec(input.balance);
	const balanceInUSD = service.calculateBalanceInUSD(
		balance,
		rate,
		input.currency,
	);
	const account = await tx.assetAccount.create({
		data: {
			...(input.id ? { id: input.id } : {}),
			userId,
			...otherFields(input),
			balance: balance.toFixed(),
			exchangeRate: columnFromFloat(rate, 6),
			exchangeRateType: rateType,
		},
	});
	await service.recordAssetSnapshot(
		tx,
		account.id,
		today,
		balance,
		balanceInUSD,
		userId,
		{
			currency: input.currency,
			type: input.type,
			exchangeRateType: rateType,
		},
	);
	return account;
}

export const createAccount = (
	db: Db,
	userId: string,
	input: AccountFields,
	timeZone?: string,
) =>
	userTransaction(db, userId, (tx) =>
		createAccountIn(tx, userId, input, timeZone),
	);

/** Edits an open account. A new rate type is a dated switch (D3); a new balance a checkpoint. */
/**
 * Legs are signed in what you have and an account's history reads them by
 * its type, so once money moved through it neither its currency nor which
 * side of net worth it is on (something you have or something you owe) can
 * change.
 */
async function refuseLegChanges(
	tx: Prisma.TransactionClient,
	existing: { id: string; currency: string; type: AssetType },
	input: Pick<AccountFields, "currency" | "type">,
) {
	const currency = existing.currency !== input.currency;
	const side = isLiability(existing.type) !== isLiability(input.type);
	if (!currency && !side) return;
	const legs = await tx.accountLeg.count({ where: { accountId: existing.id } });
	if (legs === 0) return;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: currency
			? "Money moved through this account in its currency. Add a new account instead."
			: "Money moved through this account as something you have or owe. Add a new account instead.",
	});
}

export async function editAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
	input: AccountFields,
	timeZone?: string,
) {
	// Resolved once, so the checkpoint and a nested rate switch share a day.
	const zone = await userTimeZone(tx, userId, timeZone);
	const today = checkpointDay(zone);
	const existing = await lockOpenAccount(tx, userId, id);
	await refuseLegChanges(tx, existing, input);
	await tx.assetAccount.update({ where: { id }, data: otherFields(input) });
	const rate = await accountRate(new WealthService(tx), input, today);
	if (rate.rateType !== existing.exchangeRateType) {
		await switchRateType(tx, userId, {
			accountId: id,
			rateType: rate.rateType,
			timeZone: zone,
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
	timeZone?: string,
) =>
	userTransaction(db, userId, (tx) =>
		editAccountIn(tx, userId, id, input, timeZone),
	);

async function ownAccount(
	db: Db | Prisma.TransactionClient,
	userId: string,
	id: string,
) {
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
export async function closeAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
) {
	const now = new Date();
	const asset = await ownAccount(tx, userId, id);
	if (asset.closedAt) return { success: true };
	await tx.assetAccount.update({
		where: { id: asset.id },
		data: { closedAt: now },
	});
	// A zero point on the closing day, so the chart drops there.
	await new WealthService(tx).recordAssetSnapshot(
		tx,
		asset.id,
		normalizeDate(now),
		0,
		0,
		userId,
		snapshotMeta(asset),
	);
	return { success: true };
}

export const closeAccount = (db: Db, userId: string, id: string) =>
	userTransaction(db, userId, (tx) => closeAccountIn(tx, userId, id));

/** Today's rate of the account's type, else its stored rate; none throws MissingRateError. */
async function reopenRate(
	service: WealthService,
	asset: {
		currency: string;
		exchangeRate: DecimalInput | null;
		exchangeRateType: string | null;
	},
	today: Date,
): Promise<number> {
	try {
		const { rate } = await service.resolveExchangeRate(asset.currency, today, {
			rate: asset.exchangeRate,
			type: asset.exchangeRateType,
		});
		return rate;
	} catch {
		// No table rate: the account's own stored rate, if any
		if (asset.exchangeRate !== null && hasRate(asset.currency, asset.exchangeRate))
			return toFloat(asset.exchangeRate);
		throw new MissingRateError(asset.currency);
	}
}

/**
 * Reopens a closed account with the balance it had. That balance is recorded
 * for today, so the history picks the account up again from the day it was
 * reopened (the closed days stay at 0). A balance of 0 is 0 USD at any rate;
 * any other balance with no rate to value it writes nothing: a missing rate
 * is never a USD value of 0.
 */
export async function reopenAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
) {
	const today = normalizeDate(new Date());
	const asset = await ownAccount(tx, userId, id);
	if (!asset.closedAt) return { success: true };
	const service = new WealthService(tx);
	const balance = dec(asset.balance.toString());
	const balanceInUSD = balance.isZero()
		? "0.00"
		: service.calculateBalanceInUSD(
				balance,
				await reopenRate(service, asset, today),
				asset.currency,
			);
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
	return { success: true };
}

export const reopenAccount = (db: Db, userId: string, id: string) =>
	userTransaction(db, userId, (tx) => reopenAccountIn(tx, userId, id));

/**
 * Deletes an account and its whole history (snapshots, legs) as if it never
 * existed. Past net worth changes; closing is the way to keep it. A move to
 * or from it keeps its other leg.
 */
export async function deleteAccountIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
) {
	const result = await tx.assetAccount.deleteMany({ where: { id, userId } });
	if (result.count === 0) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
	}
	return { success: true };
}

/**
 * The web's delete has no undo, so the uploaded picture goes with the account
 * (after the commit; a failure only leaves a file behind). The API's delete
 * keeps it for its undo stash (api-v1/idempotency.service.ts prunes it).
 */
export async function deleteAccount(db: Db, userId: string, id: string) {
	let picture: string | null = null;
	const result = await userTransaction(db, userId, async (tx) => {
		const row = await tx.assetAccount.findFirst({
			where: { id, userId },
			select: { iconKind: true, iconValue: true },
		});
		if (row?.iconKind === "IMAGE") picture = row.iconValue;
		return deleteAccountIn(tx, userId, id);
	});
	if (picture) await deleteFile(picture).catch(() => {});
	return result;
}

/** Balance in USD from the stored rate, as a Decimal; null when there is no usable rate. */
function usdValue(
	balance: Decimal,
	currency: string,
	rate: DecimalInput | null,
): Decimal | null {
	if (currency === USD) return balance;
	if (rate === null || !hasRate(currency, rate)) return null;
	return isCrypto(currency) ? balance.mul(dec(rate)) : balance.div(dec(rate));
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
			const balance = dec(asset.balance.toString());
			try {
				const { rate } = await service.resolveExchangeRate(
					asset.currency,
					today,
					{
						rate: asset.exchangeRate,
						type: asset.exchangeRateType,
					},
				);
				return usdValue(balance, asset.currency, rate);
			} catch {
				// No table rate: the asset's own stored rate, else left blank
				return usdValue(balance, asset.currency, asset.exchangeRate);
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
	const exact = (value: { toString(): string } | null) =>
		value === null ? null : new CsvNumber(value.toString());
	const rows = assets.map((asset, i) => [
		asset.name,
		asset.type,
		asset.currency,
		exact(asset.balance),
		exact(balancesInUSD[i] ?? null),
		exact(asset.exchangeRate),
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
	timeZone?: string,
) {
	let successCount = 0;
	let errorCount = 0;
	// Matched by name here, not in SQL: a name may be ciphertext in the database.
	// An account made for one row is found by a later row with the same name.
	const open = new Map<string, string>();
	for (const a of await db.assetAccount.findMany({
		where: { userId, closedAt: null },
		select: { id: true, name: true },
		orderBy: { createdAt: "asc" },
	}))
		if (!open.has(a.name)) open.set(a.name, a.id);
	for (const row of rows) {
		try {
			const existingId = open.get(row.name);
			if (existingId) await editAccount(db, userId, existingId, row, timeZone);
			else {
				const created = await createAccount(db, userId, row, timeZone);
				open.set(row.name, created.id);
			}
			successCount++;
		} catch (error) {
			console.error("Failed to import a wealth row:", error);
			errorCount++;
		}
	}
	return { successCount, errorCount };
}
