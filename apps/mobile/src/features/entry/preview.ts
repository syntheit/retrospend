import type { RetrospendClient } from "@retrospend/api-client";
import type { PendingWrite } from "./draft";

// "What this changes" (R30): the server's dry run of the same write that Save
// makes, so the preview equals the result. This file asks for it and orders
// what comes back; the words and the money formatting are the screen's.

export type PreviewDto = Awaited<
	ReturnType<RetrospendClient["income"]["previewCreate"]>
>;

export type PreviewState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; diff: PreviewDto }
	/** The server could not be reached: the write will wait on the phone. */
	| { status: "offline" }
	/** The server refused the dry run: no rate for the currency, or a field it rejects. */
	| { status: "refused"; reason: "missingRate" | "other"; currency: string };

/** No answer for this long reads as offline; Save then waits on the phone. */
const PREVIEW_TIMEOUT_MS = 8000;

type CallOptions = { signal: AbortSignal };

function dryRun(
	api: RetrospendClient,
	write: PendingWrite,
	options: CallOptions,
): Promise<PreviewDto> {
	const body = write.body;
	switch (write.entity) {
		case "expenses":
			return write.kind === "update"
				? api.expenses.previewUpdate(
						body as Parameters<typeof api.expenses.previewUpdate>[0],
						options,
					)
				: api.expenses.previewCreate(
						body as Parameters<typeof api.expenses.previewCreate>[0],
						options,
					);
		case "shared-expenses":
			return write.kind === "update"
				? api["shared-expenses"].previewUpdate(
						body as Parameters<
							(typeof api)["shared-expenses"]["previewUpdate"]
						>[0],
						options,
					)
				: api["shared-expenses"].previewCreate(
						body as Parameters<
							(typeof api)["shared-expenses"]["previewCreate"]
						>[0],
						options,
					);
		case "transfers":
			return api.transfers.previewCreate(
				body as Parameters<typeof api.transfers.previewCreate>[0],
				options,
			);
		case "income":
			return api.income.previewCreate(
				body as Parameters<typeof api.income.previewCreate>[0],
				options,
			);
	}
}

export async function fetchPreview(
	api: RetrospendClient,
	write: PendingWrite,
): Promise<PreviewState> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const diff = await dryRun(api, write, options);
		return { status: "ready", diff };
	} catch (error) {
		// A thrown error without a status never reached the server. A 401 is the
		// session ending; the write waits on the phone for the next sign in.
		const { status, code } = (error ?? {}) as {
			status?: number;
			code?: string;
		};
		if (status === undefined || status === 401) return { status: "offline" };
		return {
			status: "refused",
			reason: code === "missing_rate" ? "missingRate" : "other",
			currency: String(write.body.currency ?? ""),
		};
	} finally {
		clearTimeout(timer);
	}
}

type Money = { minor: number; currency: string };

/** One person whose share of a split expense the edit changes. */
export interface ShareLine {
	key: string;
	name: string;
	/** The caller: shown as "You". */
	you: boolean;
	/** Null: they join the expense with this edit. */
	before: Money | null;
	/** Null: they leave it. */
	after: Money | null;
}

/**
 * Whose share a split-expense edit moves, from the same dry run as the
 * figures (the server's detail of PUT /shared-expenses/{id}). People whose
 * share stays the same are left out; an empty list means no share moves.
 * Null for any other write.
 */
export function sharesOf(diff: PreviewDto): ShareLine[] | null {
	const detail = diff.detail as { kind?: string; shares?: unknown } | undefined;
	if (detail?.kind !== "sharedExpense.update" || !Array.isArray(detail.shares))
		return null;
	const same = (a: Money | null, b: Money | null) =>
		a !== null &&
		b !== null &&
		a.minor === b.minor &&
		a.currency === b.currency;
	return (
		detail.shares as {
			type: string;
			id: string;
			name: string;
			you?: boolean;
			before: Money | null;
			after: Money | null;
		}[]
	)
		.filter((s) => !same(s.before, s.after))
		.map((s) => ({
			key: `${s.type}:${s.id}`,
			name: s.name,
			you: s.you === true,
			before: s.before,
			after: s.after,
		}))
		.sort((a, b) => Number(b.you) - Number(a.you));
}

export interface PlanView {
	/** Why Use my plan could not run, when it did not. */
	reason: "no_envelope_budget" | "other_currency" | null;
	lines: { envelopeId: string; amount: { minor: number; currency: string } }[];
	/** What stays Not planned yet. */
	rest: { minor: number; currency: string } | null;
	applied: boolean;
}

/**
 * What Use my plan would assign, from the same dry run as the figures
 * (R30: the preview equals the result). Null for a write with no plan to
 * show, or when the person did not ask for it.
 */
export function planOf(diff: PreviewDto): PlanView | null {
	const detail = diff.detail as
		| { kind?: string; plan?: Record<string, unknown> }
		| undefined;
	const plan = detail?.kind === "income.add" ? detail.plan : undefined;
	if (!plan || plan.reason === "not_requested") return null;
	const reason = plan.reason;
	return {
		applied: plan.applied === true,
		reason:
			reason === "no_envelope_budget" || reason === "other_currency"
				? reason
				: null,
		lines: ((plan.lines as PlanView["lines"] | undefined) ?? []).map((l) => ({
			envelopeId: l.envelopeId,
			amount: l.amount,
		})),
		rest: (plan.rest as PlanView["rest"]) ?? null,
	};
}

/** The order places are listed in, as on the web. */
const ORDER = [
	"accounts.balance",
	"notTracked",
	"owed.owedToYou",
	"owed.youOwe",
	"envelope.left",
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"spent",
	"netWorth",
];
/** Parts of net worth's 30-day breakdown: the net worth line already says it. */
const HIDDEN = /^netWorthChange\./;
/** Budget figures that read nothing on both sides: no envelope budget, not unknown. */
const BUDGET = /^budget\./;

const rank = (id: string) => {
	const i = ORDER.indexOf(id);
	return i < 0 ? ORDER.length : i;
};

export interface ChangeLine {
	key: string;
	figure: string;
	delta: { minor: number; currency: string };
	after: { minor: number; currency: string } | null;
	/** A total converted at reference rates: an estimate, shown with the approximate mark. */
	approx: boolean;
}

export interface ChangeLines {
	/** Places that move, before to after. */
	moved: ChangeLine[];
	/** Places the dry run checked and found unchanged. */
	stays: string[];
	/** Places that could not be read (a missing rate). */
	unknown: string[];
}

/** Percent lines belong to figures these writes never touch; money only. */
const isMoney = (line: { currency: string }) => line.currency !== "%";

export function changeLines(diff: PreviewDto): ChangeLines {
	const moved = diff.changes
		.filter((c) => !HIDDEN.test(c.id) && isMoney(c.delta))
		.slice()
		.sort((a, b) => rank(a.id) - rank(b.id))
		.map((c) => ({
			key: `${c.id}-${c.currency}`,
			figure: c.id,
			delta: c.delta,
			after: c.after,
			approx: c.approx === true,
		}));
	const movedIds = new Set(moved.map((m) => m.figure));
	const stays = diff.unchanged
		.map((u) => (u.id === "accounts.balance" ? "accounts" : u.id))
		.filter((id) => !HIDDEN.test(id) && !movedIds.has(id));
	const unknown = diff.unavailable
		.filter(
			(u) =>
				!HIDDEN.test(u.id) &&
				!(BUDGET.test(u.id) && u.before == null && u.after == null),
		)
		.map((u) => u.id);
	return { moved, stays: [...new Set(stays)], unknown };
}
