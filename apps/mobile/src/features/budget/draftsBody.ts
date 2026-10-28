import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// Drafts: the plan for a coming month and What if. A draft is only a
// proposal until it is applied, so saving one moves no money.

type Client = RetrospendClient["budget"];
export type SaveDraftInput = Parameters<Client["saveDraft"]>[0];
export type DraftsRead = Awaited<ReturnType<Client["drafts"]>>;
export type Draft = NonNullable<DraftsRead["open"]>;
export type DraftOutcome = Awaited<ReturnType<Client["draftOutcome"]>>;
export type FundNowInput = Parameters<Client["fundPlanNow"]>[0];
export type ApplyDraftInput = Parameters<Client["applyDraft"]>[0];

/** The month after `key` (YYYYMM). */
export function nextMonthKey(key: number): number {
	return key % 100 === 12 ? key + 89 : key + 1;
}

/** The draft being edited, else the saved plan. */
export function planBase(read: DraftsRead | null): Draft | null {
	return read?.open ?? read?.saved ?? null;
}

/** What an envelope has planned in a draft, or null when it has no line. */
export function plannedFor(
	draft: Draft | null,
	envelopeId: string,
): { minor: number; currency: string } | null {
	const line = draft?.lines.find((l) => l.envelopeId === envelopeId);
	return line ? line.amount : null;
}

type Line = SaveDraftInput["lines"] extends (infer L)[] | undefined ? L : never;

/** The draft's lines as the write wants them (decimal text). */
export function linesOf(draft: Draft | null): Line[] {
	return (draft?.lines ?? []).map((l) => ({
		envelopeId: l.envelopeId,
		amount: wireAmount(l.amount.minor, l.amount.currency),
	}));
}

/** Every other line kept, this envelope set to `minor`. */
export function linesWith(
	draft: Draft | null,
	envelopeId: string,
	minor: number,
	currency: string,
): Line[] {
	return [
		...linesOf(draft).filter((l) => l.envelopeId !== envelopeId),
		{ envelopeId, amount: wireAmount(minor, currency) },
	];
}

/**
 * Save the plan for `month`. It keeps what the draft already expected in, so
 * an edit to one envelope never drops the rest of the plan.
 */
export function planBody(input: {
	id: string;
	month: number;
	lines: Line[];
	base: Draft | null;
}): SaveDraftInput {
	return {
		id: input.id,
		kind: "PLAN",
		month: input.month,
		lines: input.lines,
		moves: [],
		expectedIn: (input.base?.expectedIn ?? []).map((e) => ({
			id: e.id,
			templateId: e.templateId,
			categoryId: e.categoryId,
			amount: wireAmount(e.amount.minor, e.amount.currency),
		})),
		pretend: [],
	};
}

/** What if I spend this much from this envelope: a pretend expense on a draft nothing is written for. */
export function whatIfBody(input: {
	id: string;
	rowId: string;
	month: number;
	envelopeId: string | null;
	minor: number | null;
	currency: string;
}): SaveDraftInput | null {
	if (!input.envelopeId || input.minor === null || input.minor <= 0) {
		return null;
	}
	return {
		id: input.id,
		kind: "WHAT_IF",
		month: input.month,
		lines: [],
		moves: [],
		expectedIn: [],
		pretend: [
			{
				id: input.rowId,
				kind: "OUT",
				categoryId: null,
				envelopeId: input.envelopeId,
				amount: wireAmount(input.minor, input.currency),
			},
		],
	};
}
