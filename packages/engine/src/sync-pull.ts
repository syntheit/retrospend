/**
 * The pull driver: fills a device store from the server's sync routes, in the
 * order the budget block needs.
 *
 * Order: settings, the shares snapshot asked with the budget block (the block
 * is exact at one sync position, so it comes first and the deltas that follow
 * carry every cursor past it), the 17 cursor entities, the rate table, then the
 * block's promotion if its gate passes. A cursor entity is paged at the
 * largest page until the server says there is no more. The cursors belong to
 * the caller and are kept between pulls, so the second pull asks only for what
 * changed since the first.
 *
 * It talks to a structural `PullApi`, so the app's generated client and a test
 * double both fit and the engine needs no HTTP or contract package. A 410 on an
 * entity (the server can no longer honor its cursor) is not handled here: the
 * error reaches the caller, who decides to rebuild the store and pull again.
 */

import { pastPosition, promoteBudgetIfReady } from "./budget-gate";
import type { Store } from "./port";
import { applyDailyTable, type DailyTable } from "./rates";
import {
	applySettings,
	applySharesSnapshot,
	applySyncPage,
	type SyncEntity,
	type WireOf,
	type WireSettings,
	type WireShares,
} from "./sync-apply";

/** The most rows the server sends in one page. */
const PAGE_LIMIT = 500;

interface PageOf<E extends SyncEntity> {
	readonly items: readonly WireOf[E][];
	readonly tombstones: readonly { readonly id: string }[];
	readonly cursor: string;
	readonly hasMore: boolean;
}

type PageRoute<E extends SyncEntity> = (query: {
	since?: string;
	limit: number;
}) => Promise<PageOf<E>>;

/** The routes the driver calls, named as the API contract names them. */
export interface PullApi {
	sync: {
		settings(): Promise<WireSettings>;
		shares(query: { budget: "1" }): Promise<WireShares>;
		categories: PageRoute<"categories">;
		recurringTemplates: PageRoute<"recurringTemplates">;
		expenses: PageRoute<"expenses">;
		accounts: PageRoute<"accounts">;
		accountSnapshots: PageRoute<"snapshots">;
		accountLegs: PageRoute<"legs">;
		accountRateTypes: PageRoute<"rateSwitches">;
		budgetBooks: PageRoute<"budgetBooks">;
		envelopeGroups: PageRoute<"envelopeGroups">;
		envelopes: PageRoute<"envelopes">;
		envelopeCategories: PageRoute<"envelopeCategories">;
		budgetMovements: PageRoute<"budgetMovements">;
		bookPeriods: PageRoute<"bookPeriods">;
		monthCloses: PageRoute<"monthCloses">;
		wealthTransfers: PageRoute<"wealthTransfers">;
		payoffPlans: PageRoute<"payoffPlans">;
		transfers: PageRoute<"transfers">;
	};
	currencies: { dailyRates(): Promise<DailyTable> };
}

/** The cursor each entity's last page returned: the `since` of its next pull. */
export type PullCursors = Partial<Record<SyncEntity, string>>;

export interface StepReport {
	pages: number;
	rows: number;
	fetchMs: number;
	applyMs: number;
	/** With `PullOptions.pastCut`: rows of pages that end past that position, a bound on the rows the server's read had not seen. */
	pastCut?: number;
}

export type PullStep = SyncEntity | "settings" | "shares" | "rates";

export interface PullReport {
	entities: Partial<Record<PullStep, StepReport>>;
	totalMs: number;
	/** What the gate decided; absent when the shares snapshot was left out. */
	promotion?: { promoted: boolean; reason?: string };
}

export interface PullOptions {
	/** Milliseconds, for the timings. Defaults to Date.now. */
	now?: () => number;
	/**
	 * Asked when an entity says it has no more pages, with the rows the store
	 * holds for it. False asks again from the same cursor. Without it the first
	 * "no more" ends the entity.
	 */
	caughtUp?: (entity: SyncEntity, held: number) => boolean | Promise<boolean>;
	/**
	 * A server read's cut (`basis.cut`, the position every transaction at or
	 * below which was committed-visible or aborted for that read). Each cursor
	 * entity then reports `pastCut`: the rows (changes and tombstones) of pages
	 * whose cursor lies past it. A row the read had not seen is stamped past the
	 * cut (a save still open during the read has a stamp below the read's
	 * `asOf` but past its cut), so it is in such a page. Zero means the pull
	 * brought in nothing the read missed, with one narrow race: a row that
	 * changes between the stamp read and the row read comes back in its newer
	 * live state (loadPage), so a page at or below the cut can hold a row the
	 * read had not seen. That shows as a difference, not as a count.
	 */
	pastCut?: string;
	/** False leaves the shares snapshot and the budget block alone, and skips the promotion. */
	shares?: boolean;
}

interface EntityStep {
	entity: SyncEntity;
	route: (api: PullApi) => PageRoute<SyncEntity>;
}

/** Fixes the page type to the entity, which a table of mixed entities cannot. */
function step<E extends SyncEntity>(
	entity: E,
	route: (api: PullApi) => PageRoute<E>,
): EntityStep {
	// A page of E is applied only as `entity`, so the widening below is safe.
	return {
		entity,
		route: route as (api: PullApi) => PageRoute<SyncEntity>,
	};
}

/** In the order a device pulls them. */
const ENTITY_STEPS: readonly EntityStep[] = [
	step("categories", (a) => a.sync.categories),
	step("recurringTemplates", (a) => a.sync.recurringTemplates),
	step("expenses", (a) => a.sync.expenses),
	step("accounts", (a) => a.sync.accounts),
	step("snapshots", (a) => a.sync.accountSnapshots),
	step("legs", (a) => a.sync.accountLegs),
	step("rateSwitches", (a) => a.sync.accountRateTypes),
	step("budgetBooks", (a) => a.sync.budgetBooks),
	step("envelopeGroups", (a) => a.sync.envelopeGroups),
	step("envelopes", (a) => a.sync.envelopes),
	step("envelopeCategories", (a) => a.sync.envelopeCategories),
	step("budgetMovements", (a) => a.sync.budgetMovements),
	step("bookPeriods", (a) => a.sync.bookPeriods),
	step("monthCloses", (a) => a.sync.monthCloses),
	step("wealthTransfers", (a) => a.sync.wealthTransfers),
	step("payoffPlans", (a) => a.sync.payoffPlans),
	step("transfers", (a) => a.sync.transfers),
];

/** One request and the write of its body, timed. */
async function timed<T>(
	now: () => number,
	fetch: () => Promise<T>,
	apply: (body: T) => Promise<void>,
	rows: (body: T) => number,
): Promise<StepReport> {
	const started = now();
	const body = await fetch();
	const fetched = now();
	await apply(body);
	return {
		pages: 1,
		rows: rows(body),
		fetchMs: fetched - started,
		applyMs: now() - fetched,
	};
}

export function pullSettings(
	store: Store,
	api: PullApi,
	options: PullOptions = {},
): Promise<StepReport> {
	return timed(
		options.now ?? Date.now,
		() => api.sync.settings(),
		(body) => store.transaction((tx) => applySettings(tx, body)),
		() => 1,
	);
}

/** The shares snapshot with the budget block, which lands as pending until promoted. */
export function pullShares(
	store: Store,
	api: PullApi,
	options: PullOptions = {},
): Promise<StepReport> {
	return timed(
		options.now ?? Date.now,
		() => api.sync.shares({ budget: "1" }),
		(body) => store.transaction((tx) => applySharesSnapshot(tx, body)),
		(body) => body.items.length,
	);
}

export function pullRates(
	store: Store,
	api: PullApi,
	options: PullOptions = {},
): Promise<StepReport> {
	return timed(
		options.now ?? Date.now,
		() => api.currencies.dailyRates(),
		(body) => store.transaction((tx) => applyDailyTable(tx, body)),
		(body) => body.rates.length,
	);
}

/**
 * One cursor entity, from its cursor to the end. Each page is applied in its
 * own transaction and the cursor moves only after it, so an error leaves the
 * store and the cursor where the last good page put them.
 */
async function pullEntity(
	store: Store,
	api: PullApi,
	cursors: PullCursors,
	entityStep: EntityStep,
	options: PullOptions = {},
): Promise<StepReport> {
	const now = options.now ?? Date.now;
	const { entity } = entityStep;
	const route = entityStep.route(api);
	const report: StepReport = {
		pages: 0,
		rows: 0,
		fetchMs: 0,
		applyMs: 0,
		...(options.pastCut === undefined ? {} : { pastCut: 0 }),
	};
	for (;;) {
		const since = cursors[entity];
		const started = now();
		const page = await route({
			limit: PAGE_LIMIT,
			...(since ? { since } : {}),
		});
		const fetched = now();
		await store.transaction((tx) => applySyncPage(tx, entity, page));
		report.fetchMs += fetched - started;
		report.applyMs += now() - fetched;
		report.pages += 1;
		const rows = page.items.length + page.tombstones.length;
		report.rows += rows;
		if (
			options.pastCut !== undefined &&
			pastPosition(page.cursor, options.pastCut)
		)
			report.pastCut = (report.pastCut ?? 0) + rows;
		cursors[entity] = page.cursor;
		if (page.hasMore) continue;
		const held = store.list(entity).length;
		if (!options.caughtUp || (await options.caughtUp(entity, held)))
			return report;
	}
}

/**
 * Pulls everything a device reads, in order, and promotes the budget block if
 * its gate passes. `cursors` is read and updated in place.
 */
export async function pullAll(
	store: Store,
	api: PullApi,
	cursors: PullCursors,
	options: PullOptions = {},
): Promise<PullReport> {
	const now = options.now ?? Date.now;
	const started = now();
	const entities: PullReport["entities"] = {};
	entities.settings = await pullSettings(store, api, options);
	const withShares = options.shares !== false;
	if (withShares) entities.shares = await pullShares(store, api, options);
	for (const s of ENTITY_STEPS)
		entities[s.entity] = await pullEntity(store, api, cursors, s, options);
	entities.rates = await pullRates(store, api, options);
	const promotion = withShares
		? await store.transaction((tx) => promoteBudgetIfReady(tx, cursors))
		: undefined;
	return {
		entities,
		totalMs: now() - started,
		...(promotion ? { promotion } : {}),
	};
}
