/**
 * The action registry: one list per entity (R8). Add an action here once;
 * ActionMenu (the ⋯ button), ActionArea (right-click and long press, row
 * letter keys) and SwipeActions read it. Labels and confirm copy live in the
 * entityActions message namespace under <entity>.<id>.
 */
import { ACCOUNT_ACTIONS, type AccountTarget } from "./account";
import { CURRENCY_ACTIONS, type CurrencyTarget } from "./currency";
import { EXPENSE_ACTIONS, type ExpenseTarget } from "./expense";
import { PERSON_ACTIONS, type PersonTarget } from "./person";
import { PROJECT_ACTIONS, type ProjectTarget } from "./project";
import { RECURRING_ACTIONS, type RecurringTarget } from "./recurring";
import type { ActionDef } from "./types";

export type EntityTargets = {
	expense: ExpenseTarget;
	person: PersonTarget;
	project: ProjectTarget;
	account: AccountTarget;
	recurring: RecurringTarget;
	currency: CurrencyTarget;
};

export type Entity = keyof EntityTargets;

export const ACTIONS: {
	[E in Entity]: readonly ActionDef<EntityTargets[E]>[];
} = {
	expense: EXPENSE_ACTIONS,
	person: PERSON_ACTIONS,
	project: PROJECT_ACTIONS,
	account: ACCOUNT_ACTIONS,
	recurring: RECURRING_ACTIONS,
	currency: CURRENCY_ACTIONS,
};

export type {
	AccountTarget,
	CurrencyTarget,
	ExpenseTarget,
	PersonTarget,
	ProjectTarget,
	RecurringTarget,
};
