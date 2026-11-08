/**
 * Engine checkpoints (SPEC §5.13, D62): the state at the end of a closed
 * month, so a read starts its pass there instead of at the book's start.
 * Pure: what a checkpoint holds, how one is made, how the latest valid one is
 * picked, and the fingerprints that keep it honest. The server stores them on
 * MonthClose and guards them with trigger marks; a device keeps them in a
 * BudgetCheckpointCache (budget-cache.ts). Both run this code.
 *
 * A checkpoint is valid while nothing it was made from changed:
 * - rows the loader skips before it (own expenses, the book currency's
 *   rates, category links) are guarded by dirty marks;
 * - rows the loader always reads in full (shares, payments, routing, Wealth
 *   moves) are guarded by a fingerprint of their engine entries up to the
 *   month, compared on every read.
 * Missing rates of the skipped rows travel with it, so an incomplete month
 * stays flagged (R14).
 */
import type {
	BookState,
	EngineCheckpoint,
	EngineInput,
	RunningTotals,
} from "./engine";
import type { MissingRate, MonthKey } from "./types";
import type { ApproximateRow } from "./valuer";

/** What a checkpoint holds as stored (the shape of month_close.checkpoint). */
export type StoredCheckpoint = {
	v: 1;
	month: MonthKey;
	/** Envelope id to what it carries into the next month (non-zero only). */
	carry: Record<string, number>;
	totals: RunningTotals;
	missingRates: MissingRate[];
	/** Rows up to the month valued at the nearest rate ("≈"). */
	approximate: ApproximateRow[];
	/** Fingerprint of the fully loaded rows up to the month. */
	print: string;
};

export function toEngineCheckpoint(s: StoredCheckpoint): EngineCheckpoint {
	return {
		month: s.month,
		carry: new Map(Object.entries(s.carry)),
		totals: s.totals,
	};
}

/** The state at the end of `month` (a month before the last one computed). */
export function checkpointAt(
	state: BookState,
	month: MonthKey,
	p: {
		missingRates: readonly MissingRate[];
		approximate?: readonly ApproximateRow[];
		print: string;
	},
): StoredCheckpoint {
	const next = state.months.find((s) => s.month > month);
	if (!next || state.month(month).month !== month)
		throw new RangeError(`no state after month ${month}`);
	const carry: Record<string, number> = {};
	for (const [id, row] of next.envelopes)
		if (row.carryIn !== 0) carry[id] = row.carryIn;
	return {
		v: 1,
		month,
		carry,
		totals: state.runningTotals(month),
		missingRates: [...p.missingRates],
		approximate: [...(p.approximate ?? [])],
		print: p.print,
	};
}

/**
 * Fingerprints of the fully loaded inputs (shares, Wealth moves, splits
 * effects) up to and including each month, oldest first: a prefix hash, so
 * one pass gives every month's value. `hash` is any stable string hash: the
 * server stores sha256 base64url prints, a device compares its own (they
 * never leave it).
 */
export function fingerprintsWith(
	hash: (s: string) => string,
	input: Pick<EngineInput, "activity" | "moneyIn" | "splits">,
	months: readonly MonthKey[],
): Map<MonthKey, string> {
	const lines = new Map<MonthKey, string[]>();
	const add = (month: MonthKey, line: string) => {
		const list = lines.get(month) ?? [];
		list.push(line);
		lines.set(month, list);
	};
	for (const a of input.activity)
		if (a.source === "SHARE" || a.source === "WEALTH")
			add(
				a.month,
				`a|${a.id}|${a.source}|${a.minor}|${a.categoryId ?? ""}|${a.envelopeId ?? ""}|${a.pending ? 1 : 0}`,
			);
	for (const m of input.moneyIn)
		if (m.source === "WEALTH") add(m.month, `m|${m.id}|${m.minor}`);
	for (const s of input.splits)
		add(
			s.month,
			`s|${s.eventId}|${s.term}|${s.minor}|${s.envelopeId ?? ""}|${s.counterparty}|${s.currency}`,
		);
	const sorted = [...months].sort((a, b) => a - b);
	const out = new Map<MonthKey, string>();
	// Rows before the first month asked for still belong to every prefix.
	const early = [...lines.keys()]
		.filter((m) => m < (sorted[0] ?? 0))
		.flatMap((m) => lines.get(m) ?? [])
		.sort();
	let running = hash(early.join("\n"));
	for (const m of sorted) {
		const own = [...(lines.get(m) ?? [])].sort();
		running = hash(`${running}\n${m}\n${own.join("\n")}`);
		out.set(m, running);
	}
	return out;
}

/**
 * The latest checkpoint a pass may start from: before `needFrom` (the first
 * month the caller reads), before the current month, before every dirty mark,
 * and with the fingerprint of the fully loaded rows unchanged.
 */
export function pickCheckpoint<
	C extends { month: MonthKey; checkpoint: StoredCheckpoint | null },
>(
	closes: readonly C[],
	p: {
		needFrom: MonthKey;
		currentMonth: MonthKey;
		dirty: readonly { fromMonth: MonthKey }[];
		prints: ReadonlyMap<MonthKey, string>;
	},
): StoredCheckpoint | null {
	const dirtyFrom = Math.min(
		Number.POSITIVE_INFINITY,
		...p.dirty.map((d) => d.fromMonth),
	);
	let best: StoredCheckpoint | null = null;
	for (const c of closes) {
		const cp = c.checkpoint;
		if (!cp || cp.month !== c.month) continue;
		if (cp.month >= p.needFrom || cp.month >= p.currentMonth) continue;
		if (cp.month >= dirtyFrom) continue;
		if (p.prints.get(cp.month) !== cp.print) continue;
		if (!best || cp.month > best.month) best = cp;
	}
	return best;
}
