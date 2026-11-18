import { WEALTH_FIGURE_IDS } from "@retrospend/domain/accounts/account-figures";
import type { Money } from "@retrospend/domain/money-minor";
import {
	canonicalTimeZone,
	startOfDayIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import { BUDGET_FIGURE_IDS } from "../budget-figures";
import { BUDGET_GATE_ENTITIES } from "../budget-gate";
import { INSIGHTS_FIGURE_IDS } from "../insights-figures";
import { DEVICE_FIGURE_IDS } from "../registry";
import type { FigureNarrowing } from "./ports";

// The one compare of the device's figures against the server's, for every
// screen on both clients. It owns which ids a screen holds, the key format, the
// request plan, the verdict check, the report and its log line; screens pass
// data in and the flag-guarded dev hook is its only importer of code.

export type Narrow = keyof FigureNarrowing;
export type ScreenName =
	| "home"
	| "budget"
	| "wealth"
	| "recurring"
	| "insights"
	| "settings";

export interface ScreenSpec {
	/** Ids read with no narrowing, in one call. */
	readonly plain: readonly string[];
	/** Ids that each need one narrowing value, by the narrowing they take. */
	readonly narrowed: Readonly<Record<string, Narrow>>;
	/** The sync entities the figures read: a device has caught up when every one has. */
	readonly entities: readonly string[];
	/** Whether the screen also holds the budget verdict as a unit. */
	readonly verdict: boolean;
}

/** The narrowing each narrowed id takes. A test holds the plain ids to reading without one. */
const NARROWED: Readonly<Record<string, Narrow>> = Object.fromEntries(
	(
		[
			["envelope.left", "envelopeId"],
			["envelope.spent", "envelopeId"],
			["accounts.balance", "accountId"],
			["recurring.amount", "recurringId"],
			["insights.byCategory", "categoryId"],
			["insights.ytdByCategory", "categoryId"],
			["insights.ytdByCategoryUsd", "categoryId"],
			["insights.byMonth", "month"],
		] as const
	).map(([id, narrow]) => {
		if (!DEVICE_FIGURE_IDS.includes(id)) throw new Error(`Not a figure: ${id}`);
		return [id, narrow];
	}),
);

function screen(
	holds: (id: string) => boolean,
	entities: readonly string[],
	verdict = false,
): ScreenSpec {
	const ids = DEVICE_FIGURE_IDS.filter(holds);
	return {
		plain: ids.filter((id) => !(id in NARROWED)),
		narrowed: Object.fromEntries(
			ids.flatMap((id) => (NARROWED[id] ? [[id, NARROWED[id]]] : [])),
		),
		entities,
		verdict,
	};
}

const WEALTH_ENTITIES = ["accounts", "snapshots", "legs", "rateSwitches"];

export const SCREENS: Readonly<Record<ScreenName, ScreenSpec>> = {
	home: screen(
		(id) =>
			id.startsWith("glance.") ||
			id === "netWorth" ||
			id === "budget.notPlannedYet",
		[...new Set([...BUDGET_GATE_ENTITIES, ...WEALTH_ENTITIES])],
		true,
	),
	budget: screen(
		(id) => BUDGET_FIGURE_IDS.includes(id),
		BUDGET_GATE_ENTITIES,
		true,
	),
	wealth: screen((id) => WEALTH_FIGURE_IDS.includes(id), WEALTH_ENTITIES),
	recurring: screen(
		(id) => id.startsWith("recurring."),
		["recurringTemplates", "categories"],
	),
	insights: screen(
		(id) => INSIGHTS_FIGURE_IDS.includes(id),
		["expenses", "categories"],
	),
	// Home currency, zone and start day are what the basis check reads; one figure that depends on them rides along.
	settings: screen((id) => id === "glance.spent", ["expenses", "categories"]),
};

/** A figure's key: its id, then `:` and the narrowing value for a narrowed id (the e2e `data-figure` format). */
export const keyOf = (id: string, value?: string): string =>
	value === undefined ? id : `${id}:${value}`;

/** An id holds no colon, so the first one splits the key. */
export function parseKey(key: string): { id: string; value?: string } {
	const at = key.indexOf(":");
	return at < 0
		? { id: key }
		: { id: key.slice(0, at), value: key.slice(at + 1) };
}

/** The most ids GET /figures takes in a call. */
export const MAX_IDS_PER_CALL = 50;
/** The most narrowed calls one check makes. */
export const MAX_NARROWED_CALLS = 6;

export type NarrowValues = Readonly<Partial<Record<Narrow, readonly string[]>>>;

export interface PlannedCall {
	readonly ids: readonly string[];
	readonly narrowing: FigureNarrowing;
}

export interface CheckPlan {
	/** The unnarrowed call first (when the screen has plain ids), then up to MAX_NARROWED_CALLS narrowed ones. */
	readonly calls: readonly PlannedCall[];
	/** Keys this check holds, of all `of` the screen's values make. */
	readonly keys: number;
	readonly of: number;
	/** Where the next check starts, so repeated checks cover every narrowed call. */
	readonly next: number;
}

/**
 * One call per narrowing value, carrying every id that shares it, at most
 * MAX_NARROWED_CALLS of them from `start` on, wrapping, so ceil(n / 6) checks
 * in a row cover every value.
 */
export function planCheck(
	spec: ScreenSpec,
	values: NarrowValues,
	start = 0,
): CheckPlan {
	if (spec.plain.length > MAX_IDS_PER_CALL)
		throw new Error(`A call takes at most ${MAX_IDS_PER_CALL} ids`);
	const units: PlannedCall[] = (
		Object.entries(values) as [Narrow, readonly string[]][]
	).flatMap(([kind, list]) => {
		const ids = Object.keys(spec.narrowed).filter(
			(id) => spec.narrowed[id] === kind,
		);
		return ids.length === 0
			? []
			: [...new Set(list)].map((value) => ({
					ids,
					narrowing: { [kind]: value },
				}));
	});
	const n = units.length;
	const first = n === 0 ? 0 : start % n;
	const chosen =
		n <= MAX_NARROWED_CALLS
			? units
			: Array.from(
					{ length: MAX_NARROWED_CALLS },
					(_, i) => units[(first + i) % n] as PlannedCall,
				);
	const idsIn = (calls: readonly PlannedCall[]) =>
		calls.reduce((sum, c) => sum + c.ids.length, 0);
	return {
		calls: [
			...(spec.plain.length > 0
				? [{ ids: spec.plain, narrowing: {} } as PlannedCall]
				: []),
			...chosen,
		],
		keys: spec.plain.length + idsIn(chosen),
		of: spec.plain.length + idsIn(units),
		next: n <= MAX_NARROWED_CALLS ? 0 : (first + MAX_NARROWED_CALLS) % n,
	};
}

/** Lines compare exactly: minor units and currency, in returned order. Unavailable on both sides is a match, on one side a difference. */
export function sameLines(
	device: readonly Money[] | null | undefined,
	server: readonly Money[] | null | undefined,
): boolean {
	return device == null || server == null
		? (device ?? null) === (server ?? null)
		: device.length === server.length &&
				device.every(
					(m, i) =>
						m.minor === server[i]?.minor && m.currency === server[i]?.currency,
				);
}

/** The budget verdict as the compare holds it. Each client maps its own shape to this next to its source. */
export interface VerdictView {
	readonly bookId: string;
	readonly currency: string;
	readonly month: number;
	readonly today: string;
	readonly style: string;
	/** Incomplete or approximate on its side. */
	readonly incomplete: boolean;
	readonly state: string;
	readonly action: string | null;
	readonly lead: { readonly figureId: string; readonly amount: Money };
}

/**
 * What differs between two verdicts (state, action, figure, amount), or null
 * when they are not comparable: another book, month, day, currency or style,
 * either side incomplete, or Pay off debt, which leads with its own figure.
 */
export function verdictParts(
	device: VerdictView,
	server: VerdictView,
): string[] | null {
	const comparable =
		device.bookId === server.bookId &&
		device.currency === server.currency &&
		device.month === server.month &&
		device.today === server.today &&
		device.style === server.style &&
		server.style !== "DEBT_PAYOFF" &&
		!(device.incomplete || server.incomplete);
	if (!comparable) return null;
	const parts: string[] = [];
	if (device.state !== server.state) parts.push("state");
	if (device.action !== server.action) parts.push("action");
	if (device.lead.figureId !== server.lead.figureId) parts.push("figure");
	if (!sameLines([device.lead.amount], [server.lead.amount]))
		parts.push("amount");
	return parts;
}

export type KeyClass =
	| "match"
	| "differs"
	/** A device cursor is below the server read's position: the pull did not reach it. */
	| "behind"
	/** The device's rate table is not the server's. */
	| "rates_moved";

export type SkipReason =
	| "settings_differ"
	| "no_basis"
	| "no_device"
	| "period_edge"
	/** A zone the figures read in is one the runtime cannot format. */
	| "zone_unknown"
	/** Rows of the screen's entities kept arriving past the server read. */
	| "moving";

/** How close to a day boundary a read may be: the server's figures read their own clock a moment after `basis.at`. */
export const PERIOD_EDGE_MS = 60_000;

/**
 * Whether `at` is within PERIOD_EDGE_MS of midnight in any of `zones` (which
 * covers every week, month and start-day boundary), or a zone is one the
 * runtime cannot format. Never throws.
 */
export function edgeOf(
	at: Date,
	zones: readonly string[],
): "period_edge" | "zone_unknown" | null {
	const canon = zones.map((z) => canonicalTimeZone(z));
	if (canon.some((z) => z === undefined)) return "zone_unknown";
	const t = at.getTime();
	for (const zone of canon)
		if (
			t - startOfDayIn(at, zone).getTime() < PERIOD_EDGE_MS ||
			startOfNextDayIn(at, zone).getTime() - t < PERIOD_EDGE_MS
		)
			return "period_edge";
	return null;
}

/** Whether two zone names are one zone, however spelled; an unreadable name is never the same. */
export function sameZone(a: string, b: string): boolean {
	const x = canonicalTimeZone(a);
	return x !== undefined && x === canonicalTimeZone(b);
}

export interface CompareReport {
	readonly screen: ScreenName;
	readonly state: "checked" | "skipped";
	readonly skipped: SkipReason | null;
	/** Keys held this check, of all the screen's values. */
	readonly keys: number;
	readonly of: number;
	/** Keys that differ for no reason the other classes name. */
	readonly differs: readonly string[];
	readonly behind: number;
	readonly ratesMoved: number;
	readonly generation: number;
	/** The zone the client renders in against the stored one the figures read in. */
	readonly zone: "same" | "differs";
	readonly clock: string;
	/** Every key's class, and the parts a verdict differed in: for readouts and tests, never logged. */
	readonly classes: Readonly<Record<string, KeyClass>>;
	readonly verdictParts: readonly string[];
}

export const COMPARE_WHAT = "compare";

/**
 * The only log format: the detail of `warn(COMPARE_WHAT, ...)`. Fixed keys in a
 * fixed order, ids and counts only. It reads named fields, so no amount, name
 * or title can reach it.
 */
export function compareLine(r: CompareReport): string {
	return JSON.stringify({
		screen: r.screen,
		state: r.state,
		keys: r.keys,
		of: r.of,
		differs: r.differs,
		behind: r.behind,
		ratesMoved: r.ratesMoved,
		skipped: r.skipped,
		generation: r.generation,
		zone: r.zone,
		clock: r.clock,
	});
}
