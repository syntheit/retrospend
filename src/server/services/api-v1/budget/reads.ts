import type { SetupInput } from "~/lib/schemas/envelope";
import type { DraftKind, PlanFillInput } from "~/lib/schemas/envelope-plan";
import { getAfford } from "~/server/services/envelope/afford-read.service";
import {
	getBankCheck,
	getWelcomeBack,
} from "~/server/services/envelope/book-read.service";
import { debtsApi } from "~/server/services/envelope/debt-api.service";
import {
	getEnvelopeExport,
	getHiddenRows,
	getMigrationState,
	getPacing,
} from "~/server/services/envelope/migration-read.service";
import {
	draftsApi,
	getPlanCost,
	getYearView,
	rulesApi,
} from "~/server/services/envelope/plan-api.service";
import {
	getCoverSources,
	getFillFromTargets,
	getHistory,
	getLeftToSpend,
	getMonth,
	getMonthSummary,
	getOwed,
	getSetupPreset,
	getVerdict,
} from "~/server/services/envelope/read.service";
import { getUnroutedShares } from "~/server/services/envelope/unrouted-shares.service";
import { wire } from "../wire";
import type { BudgetCaller } from "./serve";

/**
 * v1 adapters for the budget reads: the same service calls as the tRPC
 * `envelope.*` queries, answered as plain JSON.
 */

type Q<T> = T;
const uid = (c: BudgetCaller) => c.principal.userId;

export const budgetReadOps = {
	setupPreset: async (c: BudgetCaller, q: Q<{ style: SetupInput["style"] }>) =>
		wire(await getSetupPreset(uid(c), q.style)),
	month: async (c: BudgetCaller, q: Q<{ month?: number }>) =>
		wire(await getMonth(uid(c), q.month, new Date(), c.timeZone)),
	verdict: async (c: BudgetCaller, q: Q<{ month?: number }>) =>
		wire(await getVerdict(uid(c), q.month)),
	leftToSpend: async (c: BudgetCaller, q: Q<{ month?: number }>) =>
		wire(await getLeftToSpend(uid(c), q.month)),
	fillFromTargets: async (
		c: BudgetCaller,
		q: Q<{ month?: number; amountMinor?: number }>,
	) => wire(await getFillFromTargets(uid(c), q.month, q.amountMinor)),
	coverSources: async (
		c: BudgetCaller,
		q: Q<{ envelopeId: string; month?: number }>,
	) => wire(await getCoverSources(uid(c), q.envelopeId, q.month)),
	history: async (
		c: BudgetCaller,
		q: Q<{
			month?: number;
			envelopeId?: string;
			cursor?: string;
			limit: number;
		}>,
	) => wire(await getHistory(uid(c), q)),
	owed: async (c: BudgetCaller) => wire(await getOwed(uid(c))),
	monthSummary: async (c: BudgetCaller, q: Q<{ month: number }>) =>
		wire(await getMonthSummary(uid(c), q.month)),
	welcomeBack: async (c: BudgetCaller) => wire(await getWelcomeBack(uid(c))),
	bankCheck: async (c: BudgetCaller) => wire(await getBankCheck(uid(c))),
	afford: async (
		c: BudgetCaller,
		q: Q<{ month?: number; amountMinor: number; envelopeId?: string }>,
	) => wire(await getAfford(uid(c), q)),
	unroutedShares: async (c: BudgetCaller, q: Q<{ limit: number }>) =>
		wire(await getUnroutedShares(uid(c), q)),
	rules: async (c: BudgetCaller) => wire(await rulesApi.list(uid(c))),
	drafts: async (c: BudgetCaller, q: Q<{ kind: DraftKind; month?: number }>) =>
		wire(await draftsApi.get(uid(c), q)),
	draftOutcome: async (c: BudgetCaller, q: Q<{ draftId: string }>) =>
		wire(await draftsApi.preview(uid(c), q.draftId)),
	planFill: async (c: BudgetCaller, q: Q<PlanFillInput>) =>
		wire(await draftsApi.fill(uid(c), q)),
	planCost: async (
		c: BudgetCaller,
		q: Q<{ month?: number; essentialIds?: string[] }>,
	) => wire(await getPlanCost(uid(c), q)),
	year: async (c: BudgetCaller, q: Q<{ year?: number }>) =>
		wire(await getYearView(uid(c), q.year)),
	payoffPlan: async (c: BudgetCaller) => wire(await debtsApi.plan(uid(c))),
	payoffProjection: async (
		c: BudgetCaller,
		q: Q<{
			strategy?: "SNOWBALL" | "AVALANCHE" | "CUSTOM";
			extraMonthlyMinor?: number;
			customOrder?: string[];
		}>,
	) => wire(await debtsApi.project(uid(c), q)),
	interestEstimate: async (c: BudgetCaller, q: Q<{ liabilityId: string }>) =>
		wire(await debtsApi.interest(uid(c), q.liabilityId)),
	migration: async (c: BudgetCaller) => wire(await getMigrationState(uid(c))),
	hiddenRows: async (c: BudgetCaller) => wire(await getHiddenRows(uid(c))),
	export: async (c: BudgetCaller) =>
		wire(await getEnvelopeExport(uid(c), c.timeZone)),
	pacing: async (c: BudgetCaller) =>
		wire(await getPacing(uid(c), new Date(), c.timeZone)),
};
