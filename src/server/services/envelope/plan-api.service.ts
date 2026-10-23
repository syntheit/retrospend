/**
 * Planning for transports (tRPC now, /api/v1 later): each call opens one RLS
 * transaction for the user. Reads run the lazy steps first (month close,
 * pending income rules). Writes here move no money (rule list edits,
 * drafts, group targets); money writes go through plan.mutation.ts.
 */
import type {
	CreateRuleInput,
	DraftKind,
	DraftPreview,
	DraftDto,
	DraftsOutput,
	GroupTargetResult,
	IncomeRuleDto,
	PlanCostDto,
	PlanCostInput,
	PlanFillInput,
	PlanFillOutput,
	SaveDraftInput,
	SetGroupTargetInput,
	UpdateRuleInput,
	YearViewDto,
} from "~/lib/schemas/envelope-plan";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import {
	discardDraft,
	getDrafts,
	planFill,
	previewDraftIn,
	saveDraft,
} from "./draft.service";
import { setGroupTarget } from "./group.service";
import { planCostIn, yearViewIn } from "./plan-read";
import { prepareRead } from "./read.service";
import {
	archiveRule,
	createRule,
	listRules,
	reorderRules,
	updateRule,
} from "./rule-crud.service";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

function run<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
	return userTransaction(db, userId, work);
}

function prepared<T>(
	userId: string,
	now: Date,
	work: (tx: Tx) => Promise<T>,
): Promise<T> {
	return run(userId, async (tx) => {
		await prepareRead(tx, userId, now);
		return work(tx);
	});
}

export const rulesApi = {
	list: (userId: string): Promise<IncomeRuleDto[]> =>
		run(userId, (tx) => listRules(tx, userId)),
	create: (userId: string, input: CreateRuleInput, now = new Date()) =>
		run(userId, (tx) => createRule(tx, userId, input, now)),
	update: (userId: string, input: UpdateRuleInput) =>
		run(userId, (tx) => updateRule(tx, userId, input)),
	reorder: (userId: string, ids: readonly string[]) =>
		run(userId, (tx) => reorderRules(tx, userId, ids)),
	archive: (userId: string, id: string, now = new Date()) =>
		run(userId, (tx) => archiveRule(tx, userId, id, now)),
};

export const draftsApi = {
	get: (
		userId: string,
		p: { kind: DraftKind; month?: MonthKey },
		now = new Date(),
	): Promise<DraftsOutput> =>
		prepared(userId, now, (tx) => getDrafts(tx, userId, p, now)),
	save: (userId: string, input: SaveDraftInput, now = new Date()): Promise<DraftDto> =>
		prepared(userId, now, (tx) => saveDraft(tx, userId, input, now)),
	discard: (userId: string, draftId: string, now = new Date()) =>
		run(userId, (tx) => discardDraft(tx, userId, draftId, now)),
	preview: (userId: string, draftId: string, now = new Date()): Promise<DraftPreview> =>
		prepared(userId, now, (tx) => previewDraftIn(tx, userId, draftId, now)),
	fill: (userId: string, input: PlanFillInput, now = new Date()): Promise<PlanFillOutput> =>
		prepared(userId, now, (tx) => planFill(tx, userId, input, now)),
};

export function getPlanCost(
	userId: string,
	input: PlanCostInput,
	now = new Date(),
): Promise<PlanCostDto> {
	return prepared(userId, now, (tx) => planCostIn(tx, userId, input, now));
}

export function getYearView(
	userId: string,
	year?: number,
	now = new Date(),
): Promise<YearViewDto> {
	return prepared(userId, now, (tx) => yearViewIn(tx, userId, year, now));
}

export function putGroupTarget(
	userId: string,
	input: SetGroupTargetInput,
): Promise<GroupTargetResult> {
	return run(userId, (tx) => setGroupTarget(tx, userId, input));
}
