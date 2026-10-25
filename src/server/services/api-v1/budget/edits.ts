import type {
	CreateRuleInput,
	SaveDraftInput,
	UpdateRuleInput,
} from "~/lib/schemas/envelope-plan";
import {
	acknowledge,
	pause,
	resume,
} from "~/server/services/envelope/book-read.service";
import { dismissMigrationNotice } from "~/server/services/envelope/migration-read.service";
import {
	draftsApi,
	rulesApi,
} from "~/server/services/envelope/plan-api.service";
import { wire } from "../wire";
import { budgetCurrencyOf, draftOut, type Renamed, toEngine } from "./amounts";
import type { BudgetCaller } from "./serve";

/**
 * v1 adapters for the budget writes that move no money and change no figure
 * (rules, drafts, pause and resume, reading a summary). They run the same
 * services as the tRPC procedures and have no preview or undo. Group targets,
 * debt terms and the payoff plan change what the plan asks, so they are money
 * writes (ops.ts).
 */

const uid = (c: BudgetCaller) => c.principal.userId;

export const budgetEditOps = {
	acknowledgeMonth: async (
		c: BudgetCaller,
		i: { month: number; revision: number },
	) => wire(await acknowledge(uid(c), i)),
	pause: async (c: BudgetCaller) => wire(await pause(uid(c))),
	resume: async (c: BudgetCaller) => wire(await resume(uid(c))),
	createRule: async (c: BudgetCaller, i: Renamed<CreateRuleInput>) =>
		wire(
			await rulesApi.create(
				uid(c),
				toEngine(i, await budgetCurrencyOf(c)) as CreateRuleInput,
			),
		),
	updateRule: async (c: BudgetCaller, i: Renamed<UpdateRuleInput>) =>
		wire(
			await rulesApi.update(
				uid(c),
				toEngine(i, await budgetCurrencyOf(c)) as UpdateRuleInput,
			),
		),
	reorderRules: async (c: BudgetCaller, i: { ids: string[] }) =>
		wire(await rulesApi.reorder(uid(c), i.ids)),
	archiveRule: async (c: BudgetCaller, i: { id: string }) =>
		wire(await rulesApi.archive(uid(c), i.id)),
	saveDraft: async (c: BudgetCaller, i: Renamed<SaveDraftInput>) =>
		wire(
			draftOut(
				await draftsApi.save(
					uid(c),
					toEngine(i, await budgetCurrencyOf(c)) as SaveDraftInput,
				),
				await budgetCurrencyOf(c),
			),
		),
	discardDraft: async (c: BudgetCaller, i: { draftId: string }) =>
		wire(
			draftOut(
				await draftsApi.discard(uid(c), i.draftId),
				await budgetCurrencyOf(c),
			),
		),
	dismissMigrationNotice: async (c: BudgetCaller) =>
		wire(await dismissMigrationNotice(uid(c))),
};
