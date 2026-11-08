/**
 * A device's checkpoint cache for the budget engine: the job the server's
 * month_close checkpoints and budget_dirty triggers do, kept in memory by the
 * local store (and never synced). A pass starts at the latest checkpoint that
 * is still valid instead of at the book's start; the result is the same
 * numbers as a full pass, which the tests hold it to.
 *
 * Two guards, as on the server (checkpoint.ts):
 * - rows the pass skips before the checkpoint (own expenses, movements, rates,
 *   category links): the store calls `markDirty(month)` when one dated in or
 *   after that month changes, which drops every checkpoint from it on;
 * - rows always passed in full (shares, Wealth moves, splits effects): their
 *   fingerprint up to the checkpoint's month must still match.
 */
import { addMonths } from "./calendar";
import {
	checkpointAt,
	fingerprintsWith,
	pickCheckpoint,
	type StoredCheckpoint,
	toEngineCheckpoint,
} from "./checkpoint";
import { type BookState, computeBook, type EngineInput } from "./engine";
import type { MissingRate, MonthKey } from "./types";
import type { ApproximateRow } from "./valuer";

export interface CachedPass {
	state: BookState;
	/** The checkpoint the pass started at, or null when it ran from the start. */
	startedAt: MonthKey | null;
	/**
	 * What the checkpoint carries from the rows behind it (R14), empty when the
	 * pass ran from the start. A caller that passed only the rows after
	 * `startedAt` must merge these with the missing and approximate rows of the
	 * rows it loaded, as the server loader does (inputs.ts), or a book with a
	 * rate missing behind the checkpoint reads complete.
	 */
	missingRates: MissingRate[];
	approximate: ApproximateRow[];
}

export class BudgetCheckpointCache {
	private readonly byMonth = new Map<MonthKey, StoredCheckpoint>();

	/** `hash` is any stable string hash; prints stay on the device. */
	constructor(private readonly hash: (s: string) => string) {}

	/** A row dated in or after `month` changed: checkpoints from there on are stale. */
	markDirty(month: MonthKey): void {
		for (const m of [...this.byMonth.keys()])
			if (m >= month) this.byMonth.delete(m);
	}

	/** Drops everything (a rate history rewrite, a restore). */
	clear(): void {
		this.byMonth.clear();
	}

	/** Months with a checkpoint, oldest first. */
	get months(): MonthKey[] {
		return [...this.byMonth.keys()].sort((a, b) => a - b);
	}

	/**
	 * Computes `input` (own rows may be all of them or only those after the
	 * returned `startedAt`: the engine ignores rows a checkpoint already
	 * holds), then remembers a checkpoint for every closed month it can.
	 *
	 * `closedMonths` are the months that have closed, oldest first.
	 * `missingThrough` and `approximateThrough` give what a checkpoint at a
	 * month carries (R14), as the server's loader does.
	 */
	run(
		input: EngineInput,
		p: {
			closedMonths: readonly MonthKey[];
			/** The first month the caller reads (default: the last closed one). */
			needFrom?: MonthKey;
			month?: MonthKey;
			missingThrough?: (month: MonthKey) => MissingRate[];
			approximateThrough?: (month: MonthKey) => ApproximateRow[];
		},
	): CachedPass {
		const prints = fingerprintsWith(this.hash, input, p.closedMonths);
		const lastClosed = addMonths(input.currentMonth, -1);
		const cp = pickCheckpoint(
			[...this.byMonth.values()].map((c) => ({
				month: c.month,
				checkpoint: c,
			})),
			{
				needFrom: p.needFrom ?? lastClosed,
				currentMonth: input.currentMonth,
				dirty: [],
				prints,
			},
		);
		const state = computeBook(
			cp ? { ...input, checkpoint: toEngineCheckpoint(cp) } : input,
			p.month,
		);
		for (const m of p.closedMonths) {
			if (m < state.firstMonth) continue;
			const print = prints.get(m);
			if (print === undefined) continue;
			// A checkpoint whose fingerprint failed is replaced, or every pass would restart before it.
			if (this.byMonth.get(m)?.print === print) continue;
			this.byMonth.set(
				m,
				checkpointAt(state, m, {
					missingRates: p.missingThrough?.(m) ?? [],
					approximate: p.approximateThrough?.(m) ?? [],
					print,
				}),
			);
		}
		return {
			state,
			startedAt: cp?.month ?? null,
			missingRates: cp ? [...cp.missingRates] : [],
			approximate: cp ? [...cp.approximate] : [],
		};
	}
}
