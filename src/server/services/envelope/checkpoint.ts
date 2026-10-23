/**
 * Engine checkpoints (SPEC §5.13, D62): the state at the end of a closed
 * month, stored on its MonthClose, so a read starts its pass there instead
 * of at the book's start. Pure: what a checkpoint holds, how it is checked
 * and how two close summaries compare.
 *
 * A checkpoint is valid while nothing it was made from changed:
 * - rows the loader skips before it (own expenses, the book currency's
 *   rates, category links) are guarded by budget_dirty marks, which
 *   triggers write;
 * - rows the loader always reads in full (shares, payments, routing, Wealth
 *   moves) are guarded by a fingerprint of their engine entries up to the
 *   month, compared on every read.
 * Missing rates of the skipped rows travel with it, so an incomplete month
 * stays flagged (R14).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MonthCloseSummary } from "~/lib/schemas/envelope";
import type {
	BookState,
	EngineCheckpoint,
	EngineInput,
	RunningTotals,
} from "./engine";
import type { MissingRate, MonthKey } from "./types";

const minor = z.number().int();

export const storedCheckpointSchema = z.object({
	v: z.literal(1),
	month: z.number().int(),
	carry: z.record(z.string(), minor),
	totals: z.object({
		moneyIn: minor,
		assigned: minor,
		overspent: minor,
		returned: minor,
		fronted: minor,
		returnedByPeople: minor,
		forgiven: minor,
		oldDebtsPaid: minor,
	}),
	missingRates: z.array(
		z.object({
			currency: z.string(),
			rateType: z.string().nullable(),
			date: z.string(),
			rowId: z.string().optional(),
		}),
	),
	print: z.string(),
});

export type StoredCheckpoint = z.infer<typeof storedCheckpointSchema>;

/** A stored checkpoint, or null when absent or from another shape. */
export function readCheckpoint(json: unknown): StoredCheckpoint | null {
	const parsed = storedCheckpointSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export function toEngineCheckpoint(s: StoredCheckpoint): EngineCheckpoint {
	return {
		month: s.month,
		carry: new Map(Object.entries(s.carry)),
		totals: s.totals as RunningTotals,
	};
}

/** The state at the end of `month` (a month before the last one computed). */
export function checkpointAt(
	state: BookState,
	month: MonthKey,
	p: { missingRates: readonly MissingRate[]; print: string },
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
		print: p.print,
	};
}

/**
 * Fingerprints of the fully loaded inputs (shares, Wealth moves, splits
 * effects) up to and including each month, oldest first: a prefix hash, so
 * one pass gives every month's value.
 */
export function fingerprints(
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

function hash(s: string) {
	return createHash("sha256").update(s).digest("base64url");
}

/** True when two summaries of one month differ in any amount or rule. */
export function summaryDiffers(
	a: MonthCloseSummary,
	b: MonthCloseSummary,
): boolean {
	return summaryKey(a) !== summaryKey(b);
}

function summaryKey(s: MonthCloseSummary): string {
	const envelopes = s.envelopes
		.filter(
			(e) =>
				e.carryIn !== 0 ||
				e.assigned !== 0 ||
				e.activity !== 0 ||
				e.left !== 0,
		)
		.map(
			(e) =>
				`${e.id}:${e.carryIn}:${e.assigned}:${e.activity}:${e.left}:${e.carried}:${e.returned}:${e.swept}:${e.overspent}:${e.sweepToId ?? ""}`,
		)
		.sort();
	const held = s.held
		.map((h) => `${h.counterparty}:${h.currency}:${h.native}:${h.held}`)
		.sort();
	return [
		s.moneyIn,
		s.assigned,
		s.overspent,
		s.returned,
		envelopes.join(","),
		held.join(","),
	].join("|");
}
