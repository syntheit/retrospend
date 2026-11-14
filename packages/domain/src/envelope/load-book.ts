/**
 * Loads one book's engine inputs (build plan 02 §5.3) from a BookSource: the
 * server's source reads through the caller's transaction (so RLS applies and
 * a preview sees its own uncommitted rows), a device's from its own store. A
 * fixed number of reads, whatever the history length: book with groups,
 * envelopes and links; movements grouped by month and sides; money in;
 * spending and refunds; shares; templates; rates.
 *
 * Every row is valued once in the book currency H (valuation.ts) and dated
 * by the calendar date the person saw in the book's zone (SPEC §5.1, C21).
 * A row without a rate is left out and listed (C18), never valued at 1.
 *
 * With a valid checkpoint (checkpoint.ts, SPEC §5.13) own rows and
 * movements are read only after it; shares, payments and Wealth moves are
 * always read in full, since the splits replay needs every debt from its
 * start and their fingerprint is what keeps the checkpoint honest.
 *
 * Pure: the load writes nothing. What a server read stores (the values this
 * load froze, a stale mark) comes back in `BookLoad` for the caller to write
 * at the same point the load ends.
 */

import type {
	BookRowCore,
	BookSource,
	CloseRowCore,
	DedicatedAccount,
	LoadedBook,
} from "./book-source";
import { addDays, addMonths } from "./calendar";
import {
	fingerprintsWith,
	pickCheckpoint,
	toEngineCheckpoint,
} from "./checkpoint";
import { dedicatedValues } from "./dedicated-goal";
import type { EngineInput } from "./engine";
import {
	activityEntries,
	moneyInEntries,
	movementEntries,
	Valuer,
	wealthEntries,
} from "./entries";
import { groupTargetOf } from "./group-view";
import { type BudgetInputsPort, rateBookFrom } from "./inputs-port";
import {
	closedRulesOf,
	staleMarkOf,
	uniqueApproximate,
	uniqueMissing,
} from "./load-state";
import type { ViewBook, ViewEnvelope } from "./month-view";
import {
	budgetMonthOf,
	isoDateIn,
	type MonthBoundary,
	monthStart,
	monthsFrom,
} from "./months";
import { buildSplitsFrom } from "./splits-input";
import {
	type LiabilityTerms,
	type TargetContext,
	type TemplateTerms,
	targetOf,
} from "./target-input";
import type { IsoDate, Minor, MonthKey } from "./types";
import type { ValuationContext } from "./valuation";
import type { FreshValue } from "./valuer";

export interface LoadContext {
	now: Date;
	/**
	 * The first month the caller reads (default: last month, which carry an
	 * overspend and the close need). Older months are not computed.
	 */
	needFrom?: MonthKey;
}

/** A load: the book, the values it valued for the first time, and the stale mark it owes. */
export interface BookLoad<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> {
	loaded: LoadedBook<R, C>;
	/** Foreign rows this load valued for the first time: the caller freezes them. */
	fresh: FreshValue[];
	/** A closed month whose checkpoint no longer matches, with no mark to say so: the caller marks it dirty from here. */
	staleFrom: MonthKey | null;
}

function periodsOf(row: BookRowCore): MonthBoundary[] {
	return row.periods.map((p) => ({
		fromMonth: p.fromMonth,
		startDay: p.startDay,
	}));
}

/** Two days of slack: the month mapping in the book zone decides. */
const SLACK_MS = 2 * 86_400_000;

function viewEnvelopes(
	row: BookRowCore,
	ctx: TargetContext,
	dedicated: ReadonlyMap<string, Minor | null>,
): ViewEnvelope[] {
	return [...row.envelopes]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((e) => {
			const target = targetOf(e, ctx);
			const value = dedicated.get(e.id);
			return {
				id: e.id,
				name: e.name,
				icon: e.icon,
				color: e.color,
				kind: e.kind,
				groupId: e.groupId,
				order: e.sortOrder,
				categoryIds: e.categories.map((c) => c.categoryId),
				archived: e.archivedAt !== null,
				targetStartMonth: e.targetStartMonth,
				liabilityId: e.targetLiabilityId ?? null,
				...target,
				// A dedicated account without a rate today leaves the goal incomplete.
				targetIncomplete: target.targetIncomplete || value === null,
				dedicatedValue: value ?? null,
			};
		});
}

function viewBook(
	row: BookRowCore,
	defaultEnvelopeId: string,
	envelopes: ViewEnvelope[],
): ViewBook {
	return {
		id: row.id,
		style: row.style,
		fundingSource: row.fundingSource,
		currency: row.currency,
		startMonth: row.startMonth,
		weekStartDay: row.weekStartDay,
		periods: periodsOf(row),
		defaultEnvelopeId,
		paused: row.pausedAt !== null,
		groups: row.groups.map((g) => ({
			id: g.id,
			name: g.name,
			role: g.role,
			order: g.sortOrder,
			...groupTargetOf(g, row.currency),
		})),
		envelopes,
	};
}

/** Rates for the book currency and every other currency a target or template needs. */
function loadRates(
	port: BudgetInputsPort,
	row: BookRowCore,
	/** Currencies templates, dedicated accounts and followed liabilities are in. */
	sources: readonly string[],
) {
	return rateBookFrom(port, {
		bookCurrency: row.currency,
		rateTypes: [
			...new Set(["official", ...row.periods.map((p) => p.rateType)]),
		],
		since: addDays(isoDateIn(row.startDate, row.timeZone), -31),
		extraCurrencies: [
			...row.envelopes.flatMap((e) =>
				e.targetCurrency ? [e.targetCurrency] : [],
			),
			...sources,
		],
	});
}

interface Setting<R extends BookRowCore> {
	row: R;
	periods: MonthBoundary[];
	today: IsoDate;
	currentMonth: MonthKey;
	valuation: ValuationContext;
	valuer: Valuer;
	templates: TemplateTerms[];
	liabilities: LiabilityTerms[];
	accounts: DedicatedAccount[];
}

async function settingOf<R extends BookRowCore, C extends CloseRowCore>(
	src: BookSource<R, C>,
	port: BudgetInputsPort,
	row: R,
	now: Date,
): Promise<Setting<R>> {
	const periods = periodsOf(row);
	const today = isoDateIn(now, row.timeZone);
	const { templates, liabilities } = await src.targetSources(row, today);
	const accounts = await src.dedicatedAccounts(row);
	const rates = await loadRates(port, row, [
		...templates.map((t) => t.currency),
		...accounts.map((a) => a.currency),
		...liabilities.map((l) => l.currency),
	]);
	const valuation: ValuationContext = {
		bookCurrency: row.currency,
		periods: row.periods.map((p) => ({
			fromMonth: p.fromMonth,
			startDay: p.startDay,
			rateType: p.rateType,
		})),
		defaultRateType: row.periods[0]?.rateType ?? "official",
		usdRate: rates.lookup,
	};
	return {
		row,
		periods,
		today,
		currentMonth: budgetMonthOf(today, periods),
		valuation,
		// Rows are valued once, at a rate dated on or before them, else at the
		// nearest one (flagged approximate), then frozen.
		valuer: new Valuer(
			{ ...valuation, usdRate: rates.onOrBefore },
			row.timeZone,
			periods,
			await src.frozenValues(row),
			{ usdRate: rates.lookup, rateDate: rates.rateDate },
		),
		templates,
		liabilities,
		accounts,
	};
}

/** Shares, payments and Wealth moves, read in full on every load. */
async function loadFull<R extends BookRowCore, C extends CloseRowCore>(
	src: BookSource<R, C>,
	port: BudgetInputsPort,
	s: Setting<R>,
) {
	const splits = buildSplitsFrom(
		await src.splits(s.row),
		s.valuer,
		s.row.startMonth,
	);
	const wealth = wealthEntries(
		await port.wealthRows(),
		s.valuer,
		s.row.currency,
	);
	const shares = activityEntries(
		{
			spending: [],
			refunds: [],
			shares: splits.shares,
			shareRate: splits.shareRate,
		},
		s.valuer,
		splits.routing,
	);
	return {
		splits,
		entries: {
			activity: [...shares, ...wealth.activity],
			moneyIn: wealth.moneyIn,
			splits: splits.replay.effects,
		},
	};
}

function finishLoad<R extends BookRowCore, C extends CloseRowCore>(
	s: Setting<R>,
	p: Pick<
		LoadedBook<R, C>,
		"input" | "splits" | "closes" | "dirty" | "checkpoint" | "prints"
	>,
): LoadedBook<R, C> {
	const dedicated = dedicatedValues(
		s.row,
		s.accounts,
		{ today: s.today, month: s.currentMonth, valuation: s.valuation },
		s.valuer.missingRates,
	);
	const envelopes = viewEnvelopes(
		s.row,
		{
			valuation: s.valuation,
			today: s.today,
			month: s.currentMonth,
			tz: s.row.timeZone,
			periods: s.periods,
			templates: new Map(s.templates.map((t) => [t.id, t])),
			liabilities: new Map(s.liabilities.map((l) => [l.id, l])),
			missingRates: s.valuer.missingRates,
		},
		dedicated,
	);
	return {
		...p,
		row: s.row,
		book: viewBook(s.row, p.input.defaultEnvelopeId, envelopes),
		today: s.today,
		missingRates: uniqueMissing([
			...(p.checkpoint?.missingRates ?? []),
			...s.valuer.missingRates,
		]),
		approximate: uniqueApproximate([
			...(p.checkpoint?.approximate ?? []),
			...s.valuer.approximate,
		]),
		periods: s.periods,
		valuation: s.valuation,
		valuer: s.valuer,
	};
}

/** Loads and values every engine input of the user's personal book, or null without one. */
export async function loadBookFrom<
	R extends BookRowCore,
	C extends CloseRowCore,
>(src: BookSource<R, C>, ctx: LoadContext): Promise<BookLoad<R, C> | null> {
	const row = await src.book();
	if (!row?.defaultEnvelopeId) return null;
	const port = src.inputs(row);
	const s = await settingOf(src, port, row, ctx.now);
	const closes = await src.closes(row);
	const dirty = await src.dirtyMarks(row);
	const full = await loadFull(src, port, s);
	const lastClosed = addMonths(s.currentMonth, -1);
	const prints =
		lastClosed >= row.startMonth
			? fingerprintsWith(
					(text) => src.hash(text),
					full.entries,
					monthsFrom(row.startMonth, lastClosed),
				)
			: new Map<MonthKey, string>();
	const checkpoint = pickCheckpoint(closes, {
		needFrom: ctx.needFrom ?? lastClosed,
		currentMonth: s.currentMonth,
		dirty,
		prints,
	});
	const after = checkpoint?.month ?? addMonths(row.startMonth, -1);
	const fromDay = monthStart(addMonths(after, 1), s.periods);
	const from = new Date(
		Math.max(
			new Date(`${fromDay}T00:00:00Z`).getTime(),
			row.startDate.getTime(),
		) - SLACK_MS,
	);
	const own = await port.ownRows({ from, afterMonth: after });
	const input: EngineInput = {
		startMonth: row.startMonth,
		currentMonth: s.currentMonth,
		defaultEnvelopeId: row.defaultEnvelopeId,
		envelopes: row.envelopes.map((e) => ({
			id: e.id,
			kind: e.kind,
			leftoverRule: e.leftoverRule,
			sweepToId: e.leftoverSweepToId,
			categoryIds: e.categories.map((c) => c.categoryId),
		})),
		moneyIn: [
			...moneyInEntries(own.moneyIn, s.valuer),
			...full.entries.moneyIn,
		],
		activity: [
			...activityEntries(
				{ ...own, shares: [], shareRate: full.splits.shareRate },
				s.valuer,
				full.splits.routing,
			),
			...full.entries.activity,
		],
		movements: movementEntries(own.movements, row.currency),
		splits: full.entries.splits,
		closedRules: closedRulesOf(closes),
		closedLinks: new Map(
			closes.flatMap((c) =>
				c.summary.links
					? [[c.month, new Map(Object.entries(c.summary.links))] as const]
					: [],
			),
		),
		checkpoint: checkpoint ? toEngineCheckpoint(checkpoint) : null,
	};
	const loaded = finishLoad<R, C>(s, {
		input,
		splits: full.splits,
		closes,
		dirty,
		checkpoint,
		prints,
	});
	return {
		loaded,
		fresh: [...s.valuer.fresh],
		staleFrom: staleMarkOf(closes, prints, dirty),
	};
}
