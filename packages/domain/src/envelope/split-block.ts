/**
 * The splits of one person's budget as a device takes them (E2EE P13b): the
 * replay's answer, not the rows it ran on. A share's category, its project
 * routing and its value, what others owe and the payments that settled it all
 * depend on rows the device must not hold (other people's shares, their
 * payments, who paid), so the server runs the replay and ships its result.
 * The block carries:
 *
 * - the caller's own shares as engine entries, already valued and routed;
 * - the replay's effects, balances and ignored events, the events and the
 *   payments to you still pending;
 * - the rows that found no category, the projects counted "Not in budget"
 *   (ids only: no figure reads a name);
 * - the rates the share side was missing, and the rows it valued at the
 *   nearest rate;
 * - what the server's checkpoint carries about rows behind it.
 *
 * Counterparties and every id that is not the caller's own become opaque keys
 * (p1.. for people, e1.. for events, settlements and pending payments),
 * numbered in order of first appearance, so the block holds no one else's
 * identity and the same key means the same thing across the block. The keys
 * are per block: the next pull may number them differently. A device that
 * reads this loads the same book as the server (load-book.ts, `splitBlock`).
 */
import type { ActivityEntry } from "./engine";
import type { PendingReceipt } from "./split-events";
import type { LoadedSplits } from "./splits-input";
import type { ReplayEvent, ReplayResult } from "./splits-replay";
import type { MissingRate } from "./types";
import type { ApproximateRow } from "./valuer";

/** What the share side of a load produced besides the replay: own shares as entries and the rates it lacked. */
export interface ShareSide {
	entries: ActivityEntry[];
	missingRates: MissingRate[];
	approximate: ApproximateRow[];
}

export interface SplitBlock {
	/** The caller's own shares, valued in the book currency and routed (source SHARE, negative). */
	shares: ActivityEntry[];
	effects: ReplayResult["effects"];
	balances: ReplayResult["balances"];
	ignored: ReplayResult["ignored"];
	events: ReplayEvent[];
	pending: PendingReceipt[];
	/** Own shares that found no category. */
	unresolved: string[];
	/** Projects counted "Not in budget". */
	notInBudget: string[];
	/** Rates the share side lacked; the rows are left out of every figure. */
	missingRates: MissingRate[];
	/** Share-side rows valued at the nearest rate. */
	approximate: ApproximateRow[];
	/** Rates missing behind the server's checkpoint when the block was made: those rows stay out. */
	checkpointMissingRates: MissingRate[];
	checkpointApproximate: ApproximateRow[];
}

/** What the server's checkpoint carries, and the caller's own row ids (kept as they are in it). */
export interface CheckpointSide {
	missingRates: readonly MissingRate[];
	approximate: readonly ApproximateRow[];
	/** Ids of the caller's own expenses among its rows. */
	own: ReadonlySet<string>;
}

/** Opaque keys in order of first appearance; ids in `keep` pass through. */
function keyer(prefix: string, keep: ReadonlySet<string> = new Set()) {
	const keys = new Map<string, string>();
	return (id: string) => {
		if (keep.has(id)) return id;
		let key = keys.get(id);
		if (!key) {
			key = `${prefix}${keys.size + 1}`;
			keys.set(id, key);
		}
		return key;
	};
}

/**
 * The block for one loaded book: its splits (the replay and its inputs) and
 * the share side of its load. Pure; `splitsFromBlock` is its inverse for the
 * fields the figures read.
 */
export function splitBlockOf(
	splits: LoadedSplits,
	share: ShareSide,
	checkpoint: CheckpointSide,
): SplitBlock {
	const own = new Set([...splits.shares.map((s) => s.id), ...checkpoint.own]);
	const person = keyer("p");
	const row = keyer("e", own);
	const events = splits.events.map((e) => ({
		...e,
		id: row(e.id),
		counterparty: person(e.counterparty),
	}));
	const pending = splits.pending.map((p) => ({
		...p,
		id: row(p.id),
		counterparty: person(p.counterparty),
	}));
	const missing = (rates: readonly MissingRate[]) =>
		rates.map((r) => (r.rowId ? { ...r, rowId: row(r.rowId) } : { ...r }));
	const nearest = (rows: readonly ApproximateRow[]) =>
		rows.map((r) => ({ ...r, rowId: row(r.rowId) }));
	return {
		shares: share.entries.map((e) => ({ ...e })),
		effects: splits.replay.effects.map((e) => ({
			...e,
			eventId: row(e.eventId),
			counterparty: person(e.counterparty),
		})),
		balances: splits.replay.balances.map((b) => ({
			...b,
			counterparty: person(b.counterparty),
		})),
		ignored: splits.replay.ignored.map((i) => ({
			...i,
			eventId: row(i.eventId),
		})),
		events,
		pending,
		unresolved: [...splits.unresolved],
		notInBudget: splits.notInBudget.map((p) => p.projectId),
		missingRates: missing(share.missingRates),
		approximate: nearest(share.approximate),
		checkpointMissingRates: missing(checkpoint.missingRates),
		checkpointApproximate: nearest(checkpoint.approximate),
	};
}

/**
 * The splits a device loads from a block: the replay and what the figures
 * read of it. Own shares come as entries (`block.shares`), so the share rows
 * are empty and nothing is routed here; there are no stored category choices
 * to save and no identities, and project names are empty (no figure reads
 * them, and a device must not show people from it).
 */
export function splitsFromBlock(block: SplitBlock): LoadedSplits {
	return {
		shares: [],
		shareRate: () => null,
		routing: { categoryOf: () => null, envelopeOf: () => null },
		replay: {
			effects: block.effects,
			balances: block.balances,
			ignored: block.ignored,
		},
		events: block.events,
		pending: block.pending,
		unresolved: new Set(block.unresolved),
		unsaved: [],
		notInBudget: block.notInBudget.map((projectId) => ({
			projectId,
			name: "",
		})),
		key: (ref) => `${ref.participantType}:${ref.participantId}`,
		me: "me",
	};
}
