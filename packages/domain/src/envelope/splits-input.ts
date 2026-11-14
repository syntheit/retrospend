/**
 * What splits mean to one person's budget (02 §3.3, §5.3 queries 5 to 7, SPEC
 * §5.8), from rows a source has read. Pure: the server reads them through the
 * caller's transaction (server/services/envelope/splits-input.ts), a device
 * from its own store. The rows are:
 *
 * - your shares, through the one share definition every spending reader
 *   uses (not rejected, outside projects you count "Not in budget"), over the
 *   whole history, since the replay needs every debt from its start;
 * - others' shares on splits you paid (any status: the cash left);
 * - payments to and from you;
 * - your project routing (D31) and your categories (D19).
 *
 * Then decides each share's category (share-category.ts), maps the rows to
 * replay events (split-events.ts) and replays them (splits-replay.ts).
 */
import { countsAsShare } from "../spent";
import type { ShareRouting, ShareRow, Valuer } from "./entries";
import {
	resolveShareCategories,
	type ShareCategoryChoice,
	type ShareCategorySource,
	type ShareForCategory,
} from "./share-category";
import {
	type PartyRef,
	type PendingReceipt,
	type SettlementRowIn,
	type SplitContext,
	type SplitPart,
	type SplitTx,
	splitEvents,
} from "./split-events";
import {
	type ReplayEvent,
	type ReplayResult,
	replaySplits,
} from "./splits-replay";
import type { MonthKey } from "./types";

/** One of your shares with the split it is on and where it lands (what shareParticipations selects). */
export interface MyShare extends SplitPart {
	/** The participant's own category for the share (budget D19). */
	categoryId: string | null;
	categorySource: ShareCategorySource | null;
	transaction: SplitTx & {
		categoryId: string | null;
		category: { userId: string } | null;
	};
}

/** A share category the smart default picked that is not stored yet. */
export interface UnsavedChoice {
	shareId: string;
	categoryId: string;
	source: Exclude<ShareCategoryChoice["source"], "USER" | null>;
}

export interface LoadedSplits {
	/** Your shares, with where each lands. */
	shares: readonly MyShare[];
	/** A share's stored rate, else the table rate on its date (never today's). */
	shareRate: (share: ShareRow) => string | null;
	routing: ShareRouting;
	replay: ReplayResult;
	events: ReplayEvent[];
	pending: PendingReceipt[];
	/** Shares that found no category: "Everything else" and one Needs you item. */
	unresolved: ReadonlySet<string>;
	unsaved: UnsavedChoice[];
	notInBudget: Array<{ projectId: string; name: string }>;
	/** Canonical key of a participant; yours is `me`. */
	key: (ref: PartyRef) => string;
	me: string;
}

function forCategory(
	share: MyShare,
	key: (ref: PartyRef) => string,
	userId: string,
	date: (d: Date) => string,
): ShareForCategory {
	const t = share.transaction;
	return {
		id: share.id,
		categoryId: share.categoryId,
		categorySource: share.categorySource,
		date: date(t.date),
		projectId: t.projectId,
		payer: key({ participantType: t.paidByType, participantId: t.paidById }),
		creatorCategory:
			t.category && t.categoryId
				? {
						id: t.categoryId,
						isMine: t.category.userId === userId,
					}
				: null,
	};
}

export interface RouteRow {
	projectId: string;
	budgetRouting: "CATEGORY" | "ENVELOPE" | "NOT_IN_BUDGET";
	budgetEnvelopeId: string | null;
	project: { name: string };
}

/** Everything the budget reads about one person's splits. */
export interface SplitInputRows {
	routes: readonly RouteRow[];
	mine: readonly MyShare[];
	fronts: readonly SplitPart[];
	settlements: readonly SettlementRowIn[];
	categories: readonly { id: string }[];
}

export interface SplitInputContext {
	userId: string;
	valuer: Valuer;
	key: (ref: PartyRef) => string;
	/** A stored rate (units per USD; crypto USD per coin) for a currency on a date, or null. */
	rate: SplitContext["rate"];
	/** The book's first month: debts owed before it are the starting position's. */
	startMonth?: MonthKey;
}

function shareChoices(rows: SplitInputRows, ctx: SplitInputContext) {
	const choices = resolveShareCategories(
		rows.mine.map((s) =>
			forCategory(s, ctx.key, ctx.userId, (d) => ctx.valuer.dated(d).date),
		),
		rows.categories,
	);
	const routeTo = new Map(
		rows.routes
			.filter((r) => r.budgetRouting === "ENVELOPE" && r.budgetEnvelopeId)
			.map((r) => [r.projectId, r.budgetEnvelopeId as string]),
	);
	const unresolved = new Set<string>();
	const unsaved: UnsavedChoice[] = [];
	for (const s of rows.mine) {
		const c = choices.get(s.id);
		// A project that routes to one envelope needs no category (D31).
		if (s.transaction.projectId && routeTo.has(s.transaction.projectId))
			continue;
		if (!c?.categoryId) unresolved.add(s.id);
		else if (!s.categoryId && c.source && c.source !== "USER")
			unsaved.push({
				shareId: s.id,
				categoryId: c.categoryId,
				source: c.source,
			});
	}
	const routing: ShareRouting = {
		categoryOf: (s) => choices.get(s.id)?.categoryId ?? null,
		envelopeOf: (s) =>
			s.transaction.projectId
				? (routeTo.get(s.transaction.projectId) ?? null)
				: null,
	};
	return { routing, unresolved, unsaved };
}

/** Routes and replays loaded split rows. Pure: the scenario tests run it on hand-made rows. */
export function buildSplits(
	rows: SplitInputRows,
	ctx: SplitInputContext,
): LoadedSplits {
	const me = ctx.key({ participantType: "user", participantId: ctx.userId });
	const excluded = rows.routes.filter(
		(r) => r.budgetRouting === "NOT_IN_BUDGET",
	);
	const notInBudget = new Set(excluded.map((r) => r.projectId));
	// shareParticipations already applies the share rule with this list; rows
	// made by hand (tests) get the same predicate here.
	const mine = rows.mine.filter((s) =>
		countsAsShare(
			{
				verificationStatus: s.verificationStatus,
				projectId: s.transaction.projectId,
			},
			[...notInBudget],
		),
	);
	const { events, pending } = splitEvents(
		{ ...rows, mine },
		{ valuer: ctx.valuer, key: ctx.key, me, notInBudget, rate: ctx.rate },
	);
	const { routing, unresolved, unsaved } = shareChoices({ ...rows, mine }, ctx);
	return {
		shares: mine,
		shareRate: (share) => ctx.rate(share.transaction),
		routing,
		replay: replaySplits(events, { startMonth: ctx.startMonth }),
		events,
		pending,
		unresolved,
		unsaved,
		notInBudget: excluded.map((r) => ({
			projectId: r.projectId,
			name: r.project.name,
		})),
		key: ctx.key,
		me,
	};
}

/** What a source reads for the splits: the rows, who is who (claimed shadows are their user), and the stored rate of a currency on a date. */
export interface SplitInputs {
	userId: string;
	rows: SplitInputRows;
	key: SplitInputContext["key"];
	rate: SplitInputContext["rate"];
}

/** Routes and replays the rows a source read (the load of every split row of one person, full history). */
export function buildSplitsFrom(
	inputs: SplitInputs,
	valuer: Valuer,
	startMonth?: MonthKey,
): LoadedSplits {
	return buildSplits(inputs.rows, {
		userId: inputs.userId,
		valuer,
		startMonth,
		key: inputs.key,
		rate: inputs.rate,
	});
}
