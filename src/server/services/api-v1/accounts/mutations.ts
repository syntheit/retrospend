import type {
	createAccountSchema,
	updateAccountSchema,
} from "@retrospend/api-contract";
import type * as z from "zod";
import { exactRate } from "~/server/services/accounts/exact-rate";
import {
	type AccountFields,
	closeAccountIn,
	createAccountIn,
	deleteAccountIn,
	editAccountIn,
	reopenAccountIn,
} from "~/server/services/accounts/manage";
import { dec } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import { assertMinorUnits, exactAmount } from "../amounts";
import { type AccountItem, accountItemIn } from "./items";

/**
 * The account writes that had no mutation of their own (create, edit, close,
 * reopen, delete) as MoneyMutations over the same in-transaction functions
 * the web calls (accounts/manage.ts), so each previews as a dry run.
 */

/** Accounts move net worth, their own balance and (on delete) the whole history. */
const FIGURES = [
	"netWorth",
	"accounts.balance",
	"netWorthChange.opened",
	"netWorthChange.closed",
	"netWorthChange.revaluation",
];

type CreateBody = z.infer<typeof createAccountSchema>;
type UpdateBody = z.infer<typeof updateAccountSchema>;
type Fields = Omit<CreateBody, "id">;

/** The service's fields from the contract's text ones. Nothing is rounded: too many decimals is a 400. */
export function toAccountFields(input: Fields): AccountFields {
	const { currency } = input;
	assertMinorUnits(input.minimumPayment, currency, "minimumPayment");
	return {
		name: input.name,
		type: input.type,
		currency,
		balance: exactAmount(input.balance, currency, "balance"),
		exchangeRate: input.exchangeRate
			? exactRate(input.exchangeRate, "exchangeRate")
			: undefined,
		exchangeRateType: input.rateType ?? undefined,
		isLiquid: input.isLiquid,
		interestRate: input.interestRate
			? exactRate(input.interestRate, "interestRate")
			: null,
		minimumPayment: input.minimumPayment
			? exactAmount(input.minimumPayment, currency, "minimumPayment")
			: null,
		dueDate: input.dueDay ?? null,
		inBudget: input.inBudget ?? null,
	};
}

/** The fields an account has now, as a body that puts them back. */
function fieldsOf(row: {
	name: string;
	type: Fields["type"];
	currency: string;
	balance: { toString(): string };
	exchangeRate: { toString(): string } | null;
	exchangeRateType: string | null;
	isLiquid: boolean;
	interestRate: { toString(): string } | null;
	minimumPayment: { toString(): string } | null;
	dueDate: number | null;
	inBudget: boolean | null;
}): Fields {
	return {
		name: row.name,
		type: row.type,
		currency: row.currency,
		balance: dec(row.balance.toString()).toString(),
		rateType: row.exchangeRateType,
		// Only the custom rate type keeps the rate as typed; the others read the table.
		exchangeRate:
			row.exchangeRateType === "custom" && row.exchangeRate
				? dec(row.exchangeRate.toString()).toString()
				: null,
		isLiquid: row.isLiquid,
		interestRate: row.interestRate
			? dec(row.interestRate.toString()).toString()
			: null,
		minimumPayment: row.minimumPayment
			? dec(row.minimumPayment.toString()).toString()
			: null,
		dueDay: row.dueDate,
		inBudget: row.inBudget,
	};
}

export const createAccountMutation: MoneyMutation<
	CreateBody & { timeZone: string },
	AccountItem
> = {
	id: "account.create",
	touches: FIGURES,
	run: async (tx, { id, timeZone, ...fields }, actor) => {
		const row = await createAccountIn(
			tx,
			actor.userId,
			{ ...toAccountFields(fields), id },
			timeZone,
		);
		return {
			value: await accountItemIn(tx, actor.userId, row.id),
			undo: { kind: "revert", mutation: "account.delete", rows: [] },
		};
	},
};

export type UpdateResult = { item: AccountItem; previous: UpdateBody | null };

export const updateAccountMutation: MoneyMutation<
	UpdateBody & { timeZone: string },
	UpdateResult
> = {
	id: "account.update",
	touches: FIGURES,
	scope: (input) => ({ accountId: input.id }),
	run: async (tx, { id, timeZone, ...fields }, actor) => {
		const before = await tx.assetAccount.findFirst({
			where: { id, userId: actor.userId },
		});
		await editAccountIn(
			tx,
			actor.userId,
			id,
			toAccountFields(fields),
			timeZone,
		);
		// An old balance with more digits than a number holds cannot be put back exactly.
		const previous = before ? { id, ...fieldsOf(before) } : null;
		const restorable =
			previous !== null &&
			(() => {
				try {
					toAccountFields(previous);
					return true;
				} catch {
					return false;
				}
			})();
		return {
			value: {
				item: await accountItemIn(tx, actor.userId, id),
				previous: restorable ? previous : null,
			},
			undo: { kind: "revert", mutation: "account.update", rows: [] },
		};
	},
};

type IdBody = { id: string };

function stateChange(
	id: string,
	run: typeof closeAccountIn,
	undo: string,
): MoneyMutation<IdBody, AccountItem> {
	return {
		id,
		touches: FIGURES,
		scope: (input) => ({ accountId: input.id }),
		run: async (tx, input, actor) => {
			await run(tx, actor.userId, input.id);
			return {
				value: await accountItemIn(tx, actor.userId, input.id),
				undo: { kind: "revert", mutation: undo, rows: [] },
			};
		},
	};
}

export const closeAccountMutation = stateChange(
	"account.close",
	closeAccountIn,
	"account.reopen",
);
export const reopenAccountMutation = stateChange(
	"account.reopen",
	reopenAccountIn,
	"account.close",
);

export const deleteAccountMutation: MoneyMutation<IdBody, { id: string }> = {
	id: "account.delete",
	touches: [...FIGURES, "netWorthChange.income", "netWorthChange.spending"],
	scope: (input) => ({ accountId: input.id }),
	run: async (tx, input, actor) => {
		await deleteAccountIn(tx, actor.userId, input.id);
		return {
			value: { id: input.id },
			// The history goes with it: nothing to put back.
			undo: { kind: "revert", mutation: "account.delete", rows: [] },
		};
	},
};
