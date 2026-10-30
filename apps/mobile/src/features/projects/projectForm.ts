import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import { type Entered, readAmount, wireAmount } from "@/features/write/amount";

// The New project and Edit project sheet's rules, apart from the screen: what
// is typed, what the server is sent, and who may do what. The server decides
// in the end; these only keep the buttons honest.

export type CreateProjectBody = Parameters<
	RetrospendClient["projects"]["create"]
>[0];
export type UpdateProjectBody = Parameters<
	RetrospendClient["projects"]["update"]
>[0];

/** What a person types. */
export interface ProjectForm {
	name: string;
	/** The project's own currency. */
	currency: string;
	/** The budget as the keypad typed it; empty is no budget. */
	budget: string;
}

/** The project being edited, as its page knows it. */
export interface ProjectOriginal {
	id: string;
	name: string;
	primaryCurrency: string;
	budget: { amount: Money } | null;
}

export const NAME_MAX = 191;

export function emptyForm(currency: string): ProjectForm {
	return { name: "", currency, budget: "" };
}

/** The roles that may change a project's settings: Owner and Editor. */
const EDIT_ROLES = new Set(["ORGANIZER", "EDITOR"]);

export function canEditProject(role: string | null): boolean {
	return role !== null && EDIT_ROLES.has(role);
}

/** Archiving and restoring are for Owners. */
export function canArchiveProject(role: string | null): boolean {
	return role === "ORGANIZER";
}

/**
 * The currency of the budget. A project whose budget was set in another
 * currency (on the web) keeps it; otherwise the budget is in the project's
 * currency.
 */
export function budgetCurrencyOf(
	form: ProjectForm,
	original: ProjectOriginal | null,
): string {
	return original?.budget?.amount.currency ?? form.currency;
}

/** The typed budget: empty, a real amount, or something that is not one. */
export function readBudget(
	form: ProjectForm,
	original: ProjectOriginal | null,
	locale: string,
): Entered {
	return readAmount(form.budget, locale, budgetCurrencyOf(form, original));
}

/** True while a budget is typed that the server would refuse (zero is not a budget). */
export function budgetInvalid(
	form: ProjectForm,
	original: ProjectOriginal | null,
	locale: string,
): boolean {
	const entered = readBudget(form, original, locale);
	return entered.state === "invalid" || entered.state === "zero";
}

/** The body that creates the project, or null while the form is not ready. */
export function createBody(
	form: ProjectForm,
	id: string,
	locale: string,
): CreateProjectBody | null {
	const name = form.name.trim();
	if (name === "" || name.length > NAME_MAX) return null;
	const entered = readBudget(form, null, locale);
	if (entered.state === "invalid" || entered.state === "zero") return null;
	return {
		id,
		name,
		primaryCurrency: form.currency,
		...(entered.state === "ok"
			? {
					budgetAmount: wireAmount(entered.minor, form.currency),
					budgetCurrency: form.currency,
				}
			: {}),
	};
}

/**
 * The body that changes the project: only what differs from the project, so
 * a field left alone stays as it is. Null while nothing changed or the form
 * is not ready.
 */
export function updateBody(
	form: ProjectForm,
	original: ProjectOriginal,
	locale: string,
): UpdateProjectBody | null {
	const name = form.name.trim();
	if (name === "" || name.length > NAME_MAX) return null;
	const entered = readBudget(form, original, locale);
	if (entered.state === "invalid" || entered.state === "zero") return null;
	const patch: Omit<UpdateProjectBody, "id"> = {};
	if (name !== original.name) patch.name = name;
	if (form.currency !== original.primaryCurrency) {
		patch.primaryCurrency = form.currency;
	}
	const had = original.budget?.amount ?? null;
	if (entered.state === "empty") {
		if (had) patch.budgetAmount = null;
	} else if (entered.state === "ok" && (!had || entered.minor !== had.minor)) {
		const currency = budgetCurrencyOf(form, original);
		patch.budgetAmount = wireAmount(entered.minor, currency);
		patch.budgetCurrency = currency;
	}
	return Object.keys(patch).length === 0 ? null : { id: original.id, ...patch };
}
