/**
 * account.create and account.update on the device: createAccountIn and
 * editAccountIn (src/server/services/accounts/manage.ts) over the store, with
 * the rules the domain owns (the rate an account is stored with, the columns'
 * text, what an account with legs may not change, the day rule) and the rows
 * the server writes: the account, its day's snapshot and, for an edit, a
 * dated rate switch and a Not logged leg.
 *
 * - Every id is the caller's (the account's, the leg's, the switch's): the
 *   device makes them, so its rows and the server's meet by id. A taken id is
 *   refused.
 * - A missing rate is MissingRateError (the device cannot book it), never a
 *   booking at 1. A zero balance needs no rate for its leg, but the account
 *   itself still needs one to be stored (as the server).
 * - The version is a placeholder (account-version.ts), and `createdAt` is the
 *   instant the device booked it.
 * - `inBudget` omitted is the default for the kind: the column becomes null on
 *   an edit too, as a v1 PUT does.
 *
 * Run through LocalDb.write or LocalDb.preview.
 */
import { accountColumnsOf } from "@retrospend/domain/accounts/columns";
import { moveDay } from "@retrospend/domain/accounts/move-day";
import type { AssetType } from "@retrospend/domain/accounts/places";
import { legChangeMessage } from "@retrospend/domain/accounts/refusals";
import {
	resolveAccountRate,
	usdKeepsRateType,
} from "@retrospend/domain/accounts/resolve-rate";
import { snapshotPlan } from "@retrospend/domain/accounts/snapshot-plan";
import { columnText, toUSDDec } from "@retrospend/domain/money-dec";
import { dec } from "@retrospend/domain/precise-decimal";
import { writeCheckpointIn } from "./account-checkpoint-local";
import {
	findRateOf,
	type Moment,
	openAccount,
	putAccount,
	refuse,
	refuseExcessDecimals,
	refusingAccount,
	writeSnapshot,
	zoneOf,
} from "./account-kit";
import { switchRateIn } from "./account-rate-local";
import type { AccountRow } from "./accounts";
import type { WriteFn } from "./local-db";
import type { Repos } from "./repos";

export const ACCOUNT_CREATE = "account.create";
export const ACCOUNT_UPDATE = "account.update";

/** What a person fills in when they add or edit an account: the v1 body's fields, amounts as decimal text. */
export interface AccountFieldsInput {
	readonly name: string;
	readonly type: AssetType;
	readonly currency: string;
	/** What you hold, or what you owe on a liability. */
	readonly balance: string;
	/** official, blue, mep, custom...; absent is the default pick. */
	readonly rateType?: string | null;
	/** Only for the custom rate type. */
	readonly exchangeRate?: string | null;
	readonly isLiquid: boolean;
	readonly interestRate?: string | null;
	readonly minimumPayment?: string | null;
	readonly dueDay?: number | null;
	readonly inBudget?: boolean | null;
}

export interface CreateAccountInput extends AccountFieldsInput, Moment {
	/** The account's client-made id. */
	readonly id: string;
}

export interface UpdateAccountInput extends AccountFieldsInput, Moment {
	readonly id: string;
	/** Client-made ids for the rows an edit can write; each is used only when that row is written. */
	readonly legId: string;
	readonly rateTypeId: string;
}

/** The columns of an account's own fields, as v1 hands them to the writer. */
const columnsOf = (input: AccountFieldsInput) =>
	accountColumnsOf({
		name: input.name,
		type: input.type,
		currency: input.currency,
		isLiquid: input.isLiquid,
		interestRate: input.interestRate ? input.interestRate : null,
		minimumPayment: input.minimumPayment ? input.minimumPayment : null,
		dueDate: input.dueDay ?? null,
		inBudget: input.inBudget ?? null,
	});

/** The transport's checks on the typed amounts: more decimals than the currency has is refused, never rounded. */
function refuseTyped(input: AccountFieldsInput) {
	refuseExcessDecimals(input.minimumPayment, input.currency, "minimumPayment");
	refuseExcessDecimals(input.balance, input.currency, "balance");
}

/** The rate an account is stored with on `day`: the table's, a typed one, or USD's own. */
function rateOf(r: Repos, input: AccountFieldsInput, day: Date) {
	return resolveAccountRate(
		input.currency,
		day,
		{ rate: input.exchangeRate, type: input.rateType },
		findRateOf(r),
	).then((resolved) =>
		usdKeepsRateType(input.currency, resolved, input.rateType),
	);
}

export function createAccount(input: CreateAccountInput): WriteFn<AccountRow> {
	return (r) =>
		refusingAccount(async () => {
			refuseTyped(input);
			const today = moveDay(null, input.now, zoneOf(r, input));
			const rate = await rateOf(r, input, today);
			const balance = dec(input.balance);
			const balanceInUSD = toUSDDec(balance, input.currency, rate.rate);
			const account: AccountRow = {
				id: input.id,
				...columnsOf(input),
				balance: balance.toFixed(),
				exchangeRate: columnText(rate.rate, 6),
				exchangeRateType: rate.rateType,
				closedAt: null,
				createdAt: new Date(input.now.getTime()),
				inBudget: input.inBudget ?? null,
				countedUnits: "0",
				iconKind: null,
				version: 0,
			};
			r.accounts.create({ account, legs: [], snapshots: [] });
			writeSnapshot(
				r,
				account.id,
				snapshotPlan({
					day: today,
					units: balance,
					usd: balanceInUSD,
					meta: {
						currency: input.currency,
						type: input.type,
						exchangeRateType: rate.rateType,
					},
					recordedAt: input.now,
				}),
			);
			return account;
		});
}

/** Edits an open account. A new rate type is a dated switch (D3); a new balance a checkpoint. */
export function updateAccount(input: UpdateAccountInput): WriteFn<AccountRow> {
	return (r) =>
		refusingAccount(async () => {
			refuseTyped(input);
			const zone = zoneOf(r, input);
			// Resolved once, so the checkpoint and the rate switch share a day.
			const today = moveDay(null, input.now, zone);
			const existing = openAccount(r, input.id);
			// Money moved through it: its currency and which side it is on stay.
			const locked = legChangeMessage(existing, input);
			if (locked !== null && (r.accounts.get(input.id)?.legs.length ?? 0) > 0)
				refuse(locked);
			putAccount(r, { ...existing, ...columnsOf(input) });
			const rate = await rateOf(r, input, today);
			if (rate.rateType !== existing.exchangeRateType)
				await switchRateIn(r, {
					accountId: input.id,
					rateTypeId: input.rateTypeId,
					rateType: rate.rateType,
					now: input.now,
					zone,
				});
			writeCheckpointIn(r, openAccount(r, input.id), {
				balance: dec(input.balance),
				rate,
				day: today,
				now: input.now,
				legId: input.legId,
			});
			return openAccount(r, input.id);
		});
}
