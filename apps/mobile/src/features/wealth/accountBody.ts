import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "@/features/budget/amount";
import { isLiability } from "./accounts";
import type { Account } from "./source";

// The body of "Add account" and "Edit account", built from what the sheet
// holds. The server's dry run and the write take this exact body, so nothing
// here converts or sums money: the balance is the keypad's own minor units
// written as decimal text.

type Client = RetrospendClient["accounts"];
export type CreateAccountBody = Parameters<Client["create"]>[0];
export type UpdateAccountBody = Parameters<Client["update"]>[0];
export type AccountType = Account["type"];

/** The types a person can pick, in the order the web lists them. */
export const ACCOUNT_TYPES: readonly AccountType[] = [
	"CASH",
	"INVESTMENT",
	"CRYPTO",
	"REAL_ESTATE",
	"VEHICLE",
	"LIABILITY_LOAN",
	"LIABILITY_CREDIT_CARD",
	"LIABILITY_MORTGAGE",
];

export interface AccountForm {
	name: string;
	type: AccountType;
	currency: string;
	/** Minor units of what it holds, or what is owed on a liability; null while not typed. */
	minor: number | null;
	/** A stored rate type of a foreign currency; null: the default. */
	rateType: string | null;
	liquid: boolean;
	/** Yearly percent as typed ("24.5"); empty for none. */
	apr: string;
	/** Minor units of the minimum payment; null for none. */
	minimumMinor: number | null;
	/** The minimum payment field holds text that is not an amount. */
	minimumInvalid?: boolean;
	/** Day of month as typed; empty for none. */
	dueDay: string;
	inBudget: boolean | null;
}

const APR = /^\d{1,3}([.,]\d{1,6})?$/;

/** A typed yearly rate the server would take; empty is fine (none). */
export function aprInvalid(apr: string): boolean {
	const text = apr.trim().replace(/%$/, "");
	return text !== "" && !APR.test(text);
}

export function dueDayOf(text: string): number | null {
	const day = Number(text.trim());
	return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

export function dueDayInvalid(text: string): boolean {
	return text.trim() !== "" && dueDayOf(text) === null;
}

/** Why the form cannot be saved yet, or null when it can. */
export function formProblem(
	form: AccountForm,
): "name" | "balance" | "apr" | "dueDay" | "minimum" | null {
	if (form.name.trim() === "") return "name";
	if (form.minor === null) return "balance";
	if (isLiability(form.type)) {
		if (aprInvalid(form.apr)) return "apr";
		if (dueDayInvalid(form.dueDay)) return "dueDay";
		// Never read a typo as "no minimum": that would clear the stored one.
		if (form.minimumInvalid) return "minimum";
	}
	return null;
}

function fields(form: AccountForm, balanceMinor: number) {
	const debt = isLiability(form.type);
	const apr = form.apr.trim().replace(/%$/, "").replace(",", ".");
	const day = dueDayOf(form.dueDay);
	return {
		name: form.name.trim(),
		type: form.type,
		currency: form.currency,
		balance: wireAmount(balanceMinor, form.currency),
		rateType: form.rateType,
		isLiquid: !debt && form.liquid,
		interestRate: debt && apr !== "" ? apr : null,
		minimumPayment:
			debt && form.minimumMinor !== null
				? wireAmount(form.minimumMinor, form.currency)
				: null,
		dueDay: debt ? day : null,
		...(form.inBudget === null ? {} : { inBudget: form.inBudget }),
	};
}

export function createBody(
	form: AccountForm,
	id: string,
): CreateAccountBody | null {
	if (formProblem(form) !== null || form.minor === null) return null;
	return { id, ...fields(form, form.minor) };
}

export function updateBody(
	form: AccountForm,
	id: string,
): UpdateAccountBody | null {
	if (formProblem(form) !== null || form.minor === null) return null;
	return { id, ...fields(form, form.minor) };
}

/** The form an existing account starts from. */
export function formOf(account: Account): AccountForm {
	return {
		name: account.name,
		type: account.type,
		currency: account.balance.currency,
		minor: account.balance.minor,
		rateType: account.rateType,
		liquid: account.isLiquid,
		apr: account.interestRate ?? "",
		minimumMinor: account.minimumPayment?.minor ?? null,
		dueDay: account.dueDay === null ? "" : String(account.dueDay),
		inBudget: account.inBudget,
	};
}

export function emptyForm(currency: string): AccountForm {
	return {
		name: "",
		type: "CASH",
		currency,
		minor: null,
		rateType: null,
		liquid: true,
		apr: "",
		minimumMinor: null,
		dueDay: "",
		inBudget: null,
	};
}
