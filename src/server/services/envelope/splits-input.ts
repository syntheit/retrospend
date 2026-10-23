/**
 * Loads what splits mean to one person's budget (02 §3.3, §5.3 queries 5 to
 * 7, SPEC §5.8), through the caller's transaction so RLS applies:
 *
 * - your shares, through the one share definition every spending reader
 *   uses (`shareParticipations`: not rejected, outside projects you count
 *   "Not in budget"), over the whole history, since the replay needs every
 *   debt from its start;
 * - others' shares on splits you paid (any status: the cash left);
 * - payments to and from you;
 * - your project routing (D31) and your categories (D19).
 *
 * Then decides each share's category (share-category.ts), maps the rows to
 * replay events (split-events.ts) and replays them (splits-replay.ts).
 */
import type { Prisma } from "~prisma";
import {
	shareParticipations,
	shareRateResolver,
} from "../shared-expense-integration";
import { resolveClaimAliases } from "../shared-expenses/identity";
import type { ShareRouting, ShareRow, Valuer } from "./entries";
import {
	resolveShareCategories,
	type ShareCategoryChoice,
	type ShareForCategory,
} from "./share-category";
import {
	type PartyRef,
	type PendingReceipt,
	type SettlementRowIn,
	type SplitContext,
	type SplitPart,
	splitEvents,
} from "./split-events";
import {
	type ReplayEvent,
	type ReplayResult,
	replaySplits,
} from "./splits-replay";

type Tx = Prisma.TransactionClient;

const SPLIT_TX = {
	select: {
		id: true,
		currency: true,
		date: true,
		exchangeRate: true,
		projectId: true,
		paidByType: true,
		paidById: true,
	},
} as const;

const SETTLEMENT_SELECT = {
	id: true,
	fromParticipantType: true,
	fromParticipantId: true,
	toParticipantType: true,
	toParticipantId: true,
	amount: true,
	currency: true,
	convertedAmount: true,
	convertedCurrency: true,
	status: true,
	kind: true,
	isOffset: true,
	confirmedByPayer: true,
	confirmedByPayee: true,
	settledAt: true,
	initiatedAt: true,
	projectId: true,
	forgiveEnvelopeId: true,
	payment: { select: { paidOn: true } },
} as const;

export type MyShare = Awaited<ReturnType<typeof shareParticipations>>[number];

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

async function loadRows(tx: Tx, userId: string, excluded: string[]) {
	const mine = await shareParticipations(tx, userId, undefined, excluded);
	const fronts = await tx.splitParticipant.findMany({
		where: {
			transaction: { paidByType: "user", paidById: userId },
			NOT: { participantType: "user", participantId: userId },
		},
		select: {
			id: true,
			participantType: true,
			participantId: true,
			shareAmount: true,
			verificationStatus: true,
			transaction: SPLIT_TX,
		},
	});
	const settlements = await tx.settlement.findMany({
		where: {
			status: { not: "REJECTED" },
			OR: [
				{ fromParticipantType: "user", fromParticipantId: userId },
				{ toParticipantType: "user", toParticipantId: userId },
			],
		},
		select: SETTLEMENT_SELECT,
	});
	const categories = await tx.category.findMany({
		where: { userId, kind: "EXPENSE" },
		select: { id: true, name: true },
	});
	return { mine, fronts, settlements, categories };
}

function refsOf(
	userId: string,
	rows: {
		mine: MyShare[];
		fronts: SplitPart[];
		settlements: SettlementRowIn[];
	},
): PartyRef[] {
	const refs: PartyRef[] = [{ participantType: "user", participantId: userId }];
	for (const p of rows.mine)
		refs.push({
			participantType: p.transaction.paidByType,
			participantId: p.transaction.paidById,
		});
	for (const p of rows.fronts) refs.push(p);
	for (const s of rows.settlements) {
		refs.push({
			participantType: s.fromParticipantType,
			participantId: s.fromParticipantId,
		});
		refs.push({
			participantType: s.toParticipantType,
			participantId: s.toParticipantId,
		});
	}
	return refs;
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
						name: t.category.name,
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
	categories: readonly { id: string; name: string }[];
}

export interface SplitInputContext {
	userId: string;
	valuer: Valuer;
	key: (ref: PartyRef) => string;
	/** A stored rate (units per USD; crypto USD per coin) for a currency on a date, or null. */
	rate: SplitContext["rate"];
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
	// The share definition already leaves "Not in budget" projects out; rows
	// made by hand (tests) get the same rule here.
	const mine = rows.mine.filter(
		(s) =>
			!(s.transaction.projectId && notInBudget.has(s.transaction.projectId)),
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
		replay: replaySplits(events),
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

/** The dates the replay values a settlement on, for the batched rate lookup. */
function settlementRateRows(s: SettlementRowIn) {
	const date = s.payment?.paidOn ?? s.settledAt ?? s.initiatedAt;
	return [
		{ currency: s.currency, date, exchangeRate: null },
		...(s.convertedCurrency
			? [{ currency: s.convertedCurrency, date, exchangeRate: null }]
			: []),
	];
}

/** Loads, routes and replays every split row of `userId` (full history). */
export async function loadSplits(
	tx: Tx,
	userId: string,
	valuer: Valuer,
): Promise<LoadedSplits> {
	const routes = await tx.projectParticipant.findMany({
		where: { participantType: "user", participantId: userId },
		select: {
			projectId: true,
			budgetRouting: true,
			budgetEnvelopeId: true,
			project: { select: { name: true } },
		},
	});
	const excluded = routes
		.filter((r) => r.budgetRouting === "NOT_IN_BUDGET")
		.map((r) => r.projectId);
	const rows = await loadRows(tx, userId, excluded);
	const { canonicalKey } = await resolveClaimAliases(tx, refsOf(userId, rows));
	const rateFor = await shareRateResolver(tx, [
		...rows.mine.map((p) => p.transaction),
		...rows.fronts.map((p) => p.transaction),
		...rows.settlements.flatMap(settlementRateRows),
	]);
	return buildSplits(
		{ ...rows, routes },
		{
			userId,
			valuer,
			key: (ref) => canonicalKey(ref),
			rate: (row) => {
				const r = rateFor(row);
				// Decimal(18,6) rates round-trip exactly through a JS number's shortest form.
				return r === null ? null : String(r);
			},
		},
	);
}
