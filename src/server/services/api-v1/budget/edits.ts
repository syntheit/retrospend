import type {
	SavePayoffPlanInput,
	SetDebtTermsInput,
} from "~/lib/schemas/envelope-debt";
import type {
	CreateRuleInput,
	SaveDraftInput,
	SetGroupTargetInput,
	UpdateRuleInput,
} from "~/lib/schemas/envelope-plan";
import {
	acknowledge,
	pause,
	resume,
} from "~/server/services/envelope/book-read.service";
import { debtsApi } from "~/server/services/envelope/debt-api.service";
import { dismissMigrationNotice } from "~/server/services/envelope/migration-read.service";
import {
	draftsApi,
	putGroupTarget,
	rulesApi,
} from "~/server/services/envelope/plan-api.service";
import type { BudgetCaller } from "./serve";
import { wire } from "./wire";

/**
 * v1 adapters for the budget writes that move no money (rules, drafts,
 * group targets, debt terms, the payoff plan, pause and resume). They run
 * the same services as the tRPC procedures and have no preview or undo.
 */

const uid = (c: BudgetCaller) => c.principal.userId;

export const budgetEditOps = {
	acknowledgeMonth: async (
		c: BudgetCaller,
		i: { month: number; revision: number },
	) => wire(await acknowledge(uid(c), i)),
	pause: async (c: BudgetCaller) => wire(await pause(uid(c))),
	resume: async (c: BudgetCaller) => wire(await resume(uid(c))),
	createRule: async (c: BudgetCaller, i: CreateRuleInput) =>
		wire(await rulesApi.create(uid(c), i)),
	updateRule: async (c: BudgetCaller, i: UpdateRuleInput) =>
		wire(await rulesApi.update(uid(c), i)),
	reorderRules: async (c: BudgetCaller, i: { ids: string[] }) =>
		wire(await rulesApi.reorder(uid(c), i.ids)),
	archiveRule: async (c: BudgetCaller, i: { id: string }) =>
		wire(await rulesApi.archive(uid(c), i.id)),
	saveDraft: async (c: BudgetCaller, i: SaveDraftInput) =>
		wire(await draftsApi.save(uid(c), i)),
	discardDraft: async (c: BudgetCaller, i: { draftId: string }) =>
		wire(await draftsApi.discard(uid(c), i.draftId)),
	setGroupTarget: async (c: BudgetCaller, i: SetGroupTargetInput) =>
		wire(await putGroupTarget(uid(c), i)),
	setDebtTerms: async (c: BudgetCaller, i: SetDebtTermsInput) =>
		wire(await debtsApi.setTerms(uid(c), i)),
	savePayoffPlan: async (c: BudgetCaller, i: SavePayoffPlanInput) =>
		wire(await debtsApi.savePlan(uid(c), i)),
	revertPayoffPlan: async (c: BudgetCaller) =>
		wire(await debtsApi.revertPlan(uid(c))),
	dismissMigrationNotice: async (c: BudgetCaller) =>
		wire(await dismissMigrationNotice(uid(c))),
};
