import type { Money } from "@retrospend/domain/money-minor";
import { BUDGET_FIGURE_IDS } from "../budget-figures";
import { BUDGET_GATE_ENTITIES, positionReached } from "../budget-gate";
import { INSIGHTS_FIGURE_IDS } from "../insights-figures";
import { DEVICE_FIGURE_IDS } from "../registry";
import type { FigureBasis, FigureNarrowing, ServerFigures } from "./ports";

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
	wealth: screen(
		(id) =>
			id === "netWorth" ||
			id.startsWith("netWorthChange.") ||
			id === "accounts.balance" ||
			id === "notTracked",
		WEALTH_ENTITIES,
	),
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
	/** A device cursor is below the server read's position: rows are still to come. */
	| "behind"
	/** The device's rate table is not the server's. */
	| "rates_moved"
	/** The device holds rows newer than the server read. */
	| "device_ahead";

export type SkipReason = "settings_differ" | "no_basis" | "no_device";

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
	readonly deviceAhead: number;
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
		deviceAhead: r.deviceAhead,
		skipped: r.skipped,
		generation: r.generation,
		zone: r.zone,
		clock: r.clock,
	});
}

type Lines = ReadonlyMap<string, readonly Money[] | null | undefined>;

/** What the platform gives the compare: the server, the device's rows, and its pull. */
export interface CompareDeps {
	readonly figures: {
		read(query: { ids: string } & FigureNarrowing): Promise<ServerFigures>;
	};
	/** The device's readings at the server's read instant, or null when it holds nothing it can trust. */
	read(query: {
		ids: readonly string[];
		narrowing: FigureNarrowing;
		at: Date;
		verdict: boolean;
	}): Promise<{ lines: Lines; verdict: VerdictView | null } | null>;
	pull(): Promise<void>;
	/** The cursor of each sync entity the device's last pull ended on. */
	cursors(): Readonly<Partial<Record<string, string>>>;
	/** The rate table version the device holds (the same value as `basis.ratesAsOf`). */
	ratesAsOf(): string | null;
	settings(): {
		homeCurrency: string;
		timeZone: string;
		startDay: number;
	} | null;
	generation(): number;
	now(): Date;
}

export interface CompareRequest {
	readonly screen: ScreenName;
	/** The narrowing values the screen renders. */
	readonly values?: NarrowValues;
	/** Rotation: the `next` of the last check of this screen. */
	readonly start?: number;
	/** The zone the client renders in. */
	readonly browserZone: string;
	/** The server verdict the screen already rendered; the compare checks what is on screen. */
	readonly verdict?: VerdictView | null;
}

interface Answer {
	readonly call: PlannedCall;
	readonly basis: FigureBasis;
	/** Keys of this call whose lines differ. */
	readonly diff: readonly string[];
	/** What the verdict differs in, on the unnarrowed call when it was held; null when it was not (or is not comparable). */
	readonly verdict: readonly string[] | null;
}

const isPlain = (call: PlannedCall) => Object.keys(call.narrowing).length === 0;
const keyIn = (call: PlannedCall, id: string) =>
	keyOf(id, Object.values(call.narrowing)[0]);

/** Reads the server for every call, then the device at each call's read instant: the order after a pull. */
async function readCalls(
	deps: CompareDeps,
	calls: readonly PlannedCall[],
	verdict: VerdictView | null,
): Promise<Answer[] | SkipReason> {
	const servers: ServerFigures[] = [];
	for (const call of calls) {
		const answer = await deps.figures.read({
			ids: call.ids.join(","),
			...call.narrowing,
		});
		// An old server or a read token answers with no basis: no more calls.
		if (!answer.basis) return "no_basis";
		servers.push(answer);
	}
	const answers: Answer[] = [];
	for (const [i, call] of calls.entries()) {
		const server = servers[i] as ServerFigures;
		const basis = server.basis as FigureBasis;
		const at = new Date(basis.at);
		if (Number.isNaN(at.getTime())) return "no_basis";
		const withVerdict = verdict !== null && isPlain(call);
		const device = await deps.read({
			ids: call.ids,
			narrowing: call.narrowing,
			at,
			verdict: withVerdict,
		});
		if (!device) return "no_device";
		answers.push({
			call,
			basis,
			diff: call.ids
				.filter(
					(id) =>
						!sameLines(
							device.lines.get(id),
							server.figures.find((f) => f.id === id)?.lines,
						),
				)
				.map((id) => keyIn(call, id)),
			verdict:
				withVerdict && verdict && device.verdict
					? verdictParts(device.verdict, verdict)
					: null,
		});
	}
	return answers;
}

const wrong = (a: Answer) => a.diff.length > 0 || (a.verdict?.length ?? 0) > 0;

/**
 * Holds one screen's device figures against the server's. A difference may be
 * a write the sync feed has not delivered: the device pulls once, the server is
 * read again, then the device, and what still differs is sorted by cause. A
 * mismatch never rejects; the caller owns errors from the network.
 */
export async function compareScreen(
	deps: CompareDeps,
	req: CompareRequest,
): Promise<{ report: CompareReport; next: number }> {
	const spec = SCREENS[req.screen];
	const plan = planCheck(spec, req.values ?? {}, req.start);
	const verdict = spec.verdict ? (req.verdict ?? null) : null;
	const done = (r: Partial<CompareReport>) => ({
		next: plan.next,
		report: {
			screen: req.screen,
			state: "checked",
			skipped: null,
			keys: plan.keys,
			of: plan.of,
			differs: [],
			behind: 0,
			ratesMoved: 0,
			deviceAhead: 0,
			zone: "same",
			classes: {},
			verdictParts: [],
			...r,
			generation: deps.generation(),
			clock: deps.now().toISOString(),
		} satisfies CompareReport,
	});
	const skip = (skipped: SkipReason) => done({ state: "skipped", skipped });
	/** The settings every figure depends on must be the server's: else the pull is the cure, and nothing else is judged. */
	const settingsSame = (list: readonly Answer[]) => {
		const own = deps.settings();
		return list.every(
			({ basis: b }) =>
				own?.homeCurrency === b.home &&
				own.timeZone === b.timeZone &&
				own.startDay === b.startDay,
		);
	};

	let answers = await readCalls(deps, plan.calls, verdict);
	if (typeof answers === "string") return skip(answers);
	if (!settingsSame(answers)) {
		await deps.pull();
		return skip("settings_differ");
	}
	if (answers.some(wrong)) {
		await deps.pull();
		const redo = answers.map(wrong);
		const again = await readCalls(
			deps,
			plan.calls.filter((_, i) => redo[i]),
			verdict,
		);
		if (typeof again === "string") return skip(again);
		let next = 0;
		answers = answers.map((a, i) => (redo[i] ? (again[next++] as Answer) : a));
		if (!settingsSame(answers)) return skip("settings_differ");
	}

	const classes: Record<string, KeyClass> = {};
	const rates = deps.ratesAsOf();
	/** Why a key still differs: lag, then rows the read missed, then the rate table, else nothing explains it. */
	const causeOf = (a: Answer): KeyClass => {
		switch (positionReached(deps.cursors(), spec.entities, a.basis.asOf)) {
			case "behind":
			case "reset":
				return "behind";
			case "ahead":
				return "device_ahead";
			case "malformed":
				return "differs";
			case "reached":
				return rates !== a.basis.ratesAsOf ? "rates_moved" : "differs";
		}
	};
	for (const a of answers)
		for (const id of a.call.ids) {
			const key = keyIn(a.call, id);
			classes[key] = a.diff.includes(key) ? causeOf(a) : "match";
		}
	const held = answers.find((a) => a.verdict !== null);
	if (held?.verdict)
		classes.verdict = held.verdict.length > 0 ? causeOf(held) : "match";
	const count = (c: KeyClass) =>
		Object.values(classes).filter((v) => v === c).length;
	return done({
		keys: plan.keys + (held ? 1 : 0),
		of: plan.of + (held ? 1 : 0),
		differs: Object.keys(classes).filter((k) => classes[k] === "differs"),
		behind: count("behind"),
		ratesMoved: count("rates_moved"),
		deviceAhead: count("device_ahead"),
		zone: answers[0]?.basis.timeZone === req.browserZone ? "same" : "differs",
		classes,
		verdictParts: held?.verdict ?? [],
	});
}
