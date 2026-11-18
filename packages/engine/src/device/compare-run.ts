import type { Money } from "@retrospend/domain/money-minor";
import { positionReached } from "../budget-gate";
import {
	type CompareReport,
	edgeOf,
	type KeyClass,
	keyOf,
	type NarrowValues,
	type PlannedCall,
	planCheck,
	SCREENS,
	type ScreenName,
	type ScreenSpec,
	type SkipReason,
	sameLines,
	sameZone,
	type VerdictView,
	verdictParts,
} from "./compare";
import type { FigureBasis, FigureNarrowing, ServerFigures } from "./ports";

// The run of one compare: server first, then the pull, then the device at the
// server's read instant. Positions are cluster-wide transaction ids, so
// "the device is past the read" says nothing about whose rows moved it; what
// tells a real difference from lag is what the pull brought in past the read.

type Lines = ReadonlyMap<string, readonly Money[] | null | undefined>;

/** Rows each sync entity's pull brought in past a position, by entity (`PullOptions.pastCut`). */
export type PulledPast = Readonly<Partial<Record<string, number>>>;

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
	/** Pulls with `pastCut` set to the read's cut; null when the pull failed. */
	pull(cut: string): Promise<PulledPast | null>;
	/** The cursor of each sync entity the device's last pull ended on. */
	cursors(): Readonly<Partial<Record<string, string>>>;
	/** The rate table version the device holds (the same value as `basis.ratesAsOf`). */
	ratesAsOf(): string | null;
	settings(): {
		homeCurrency: string;
		timeZone: string;
		startDay: number;
	} | null;
	/** The zone of the budget book the device holds, which budget figures read in, or null with none. */
	bookZone(): string | null;
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
	/**
	 * Reads the server's verdict again, through the screen's own query, so it
	 * joins the window of the figures. Absent on a screen with no verdict.
	 */
	readonly serverVerdict?: () => Promise<VerdictView | null>;
}

interface Answer {
	readonly call: PlannedCall;
	readonly basis: FigureBasis;
	/** Keys of this call whose lines differ. */
	readonly diff: readonly string[];
}

interface Round {
	readonly answers: readonly Answer[];
	/** What the verdict differs in (null when none was held or it is not comparable), read in the same window. */
	readonly verdict: readonly string[] | null;
}

/** The wire is unchecked: a basis without a string cut cannot say what the read missed. */
const hasCut = (basis: FigureBasis) =>
	typeof basis.cut === "string" && basis.cut !== "";

const isPlain = (call: PlannedCall) => Object.keys(call.narrowing).length === 0;
const keyIn = (call: PlannedCall, id: string) =>
	keyOf(id, Object.values(call.narrowing)[0]);

/** The settings every figure depends on must be the server's; else the pull was the cure and nothing else is judged. */
function settingsSame(
	deps: CompareDeps,
	bases: readonly FigureBasis[],
): boolean {
	const own = deps.settings();
	return bases.every(
		(b) =>
			own?.homeCurrency === b.home &&
			own.timeZone === b.timeZone &&
			own.startDay === b.startDay,
	);
}

/**
 * One pass: the server's figures (and verdict), the pull, then the device read
 * at the server's instant. "again" when the pull brought in rows of the screen
 * past the server's read, so the two sides did not see one set of rows.
 */
async function round(
	deps: CompareDeps,
	spec: ScreenSpec,
	calls: readonly PlannedCall[],
	req: CompareRequest,
): Promise<Round | SkipReason | "again"> {
	const servers: {
		call: PlannedCall;
		server: ServerFigures;
		basis: FigureBasis;
	}[] = [];
	for (const call of calls) {
		const server = await deps.figures.read({
			ids: call.ids.join(","),
			...call.narrowing,
		});
		// An old server or a read token answers with no basis, and one that
		// predates `cut` has none: the pull could not be measured, so no more calls.
		if (!server.basis || !hasCut(server.basis)) return "no_basis";
		servers.push({ call, server, basis: server.basis });
	}
	const serverVerdict = spec.verdict
		? ((await req.serverVerdict?.()) ?? null)
		: null;
	// Calls are in time order, so the first read's cut is the lowest.
	const first = servers[0]?.basis;
	if (!first) return "no_basis";

	const pulled = await deps.pull(first.cut);
	if (!pulled) return "no_device";
	if (
		!settingsSame(
			deps,
			servers.map((s) => s.basis),
		)
	)
		return "settings_differ";
	const book = spec.entities.includes("budgetBooks") ? deps.bookZone() : null;
	for (const { basis } of servers) {
		const at = new Date(basis.at);
		if (Number.isNaN(at.getTime())) return "no_basis";
		const edge = edgeOf(at, [basis.timeZone, ...(book ? [book] : [])]);
		if (edge) return edge;
	}
	if (spec.entities.some((entity) => (pulled[entity] ?? 0) > 0)) return "again";

	const answers: Answer[] = [];
	let verdict: readonly string[] | null = null;
	for (const { call, server, basis } of servers) {
		const withVerdict = serverVerdict !== null && isPlain(call);
		const device = await deps.read({
			ids: call.ids,
			narrowing: call.narrowing,
			at: new Date(basis.at),
			verdict: withVerdict,
		});
		if (!device) return "no_device";
		if (withVerdict && device.verdict)
			verdict = verdictParts(device.verdict, serverVerdict);
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
		});
	}
	return { answers, verdict };
}

/** Why a key differs: the pull did not reach the read, else the rate table moved, else nothing explains it. */
function causeOf(
	deps: CompareDeps,
	spec: ScreenSpec,
	basis: FigureBasis,
): KeyClass {
	switch (positionReached(deps.cursors(), spec.entities, basis.asOf)) {
		case "behind":
		case "reset":
			return "behind";
		case "malformed":
			return "differs";
		case "reached":
			return deps.ratesAsOf() !== basis.ratesAsOf ? "rates_moved" : "differs";
	}
}

/**
 * Holds one screen's device figures against the server's. The server is read
 * first, then the device pulls, then it reads at the server's instant; when the
 * pull brought in rows of the screen past the server's read, both are read
 * once more, and rows still arriving end the check as `moving`. What differs
 * after that is sorted by cause. A mismatch never rejects; the caller owns
 * errors from the network.
 */
export async function compareScreen(
	deps: CompareDeps,
	req: CompareRequest,
): Promise<{ report: CompareReport; next: number }> {
	const spec = SCREENS[req.screen];
	const plan = planCheck(spec, req.values ?? {}, req.start);
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
			zone: "same",
			classes: {},
			verdictParts: [],
			...r,
			generation: deps.generation(),
			clock: deps.now().toISOString(),
		} satisfies CompareReport,
	});
	const skip = (skipped: SkipReason) => done({ state: "skipped", skipped });

	let got = await round(deps, spec, plan.calls, req);
	if (got === "again") got = await round(deps, spec, plan.calls, req);
	if (got === "again") return skip("moving");
	if (typeof got === "string") return skip(got);

	const classes: Record<string, KeyClass> = {};
	for (const a of got.answers)
		for (const id of a.call.ids) {
			const key = keyIn(a.call, id);
			classes[key] = a.diff.includes(key)
				? causeOf(deps, spec, a.basis)
				: "match";
		}
	const last = got.answers.at(-1)?.basis;
	if (got.verdict && last)
		classes.verdict =
			got.verdict.length > 0 ? causeOf(deps, spec, last) : "match";
	const count = (c: KeyClass) =>
		Object.values(classes).filter((v) => v === c).length;
	const held = got.verdict ? 1 : 0;
	return done({
		keys: plan.keys + held,
		of: plan.of + held,
		differs: Object.keys(classes).filter((k) => classes[k] === "differs"),
		behind: count("behind"),
		ratesMoved: count("rates_moved"),
		zone: last && sameZone(last.timeZone, req.browserZone) ? "same" : "differs",
		classes,
		verdictParts: got.verdict ?? [],
	});
}
