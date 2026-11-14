/**
 * Engine checkpoints on the server (SPEC §5.13, D62): what a checkpoint holds
 * and how it is picked live in @retrospend/domain/envelope/checkpoint, shared
 * with devices. Here: the stored JSON's schema, the sha256 fingerprints the
 * month_close rows carry, and how two close summaries compare.
 */
import { createHash } from "node:crypto";
import { fingerprintsWith } from "@retrospend/domain/envelope/checkpoint";
import type { EngineInput } from "@retrospend/domain/envelope/engine";
import type { MonthKey } from "@retrospend/domain/envelope/types";
import { z } from "zod";
import type { MonthCloseSummary } from "~/lib/schemas/envelope";

export {
	checkpointAt,
	toEngineCheckpoint,
} from "@retrospend/domain/envelope/checkpoint";

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
	/** Rows up to the month valued at the nearest rate ("≈"). */
	approximate: z
		.array(z.object({ rowId: z.string(), date: z.string() }))
		.default([]),
	print: z.string(),
});

/** Plain JSON, so Prisma accepts it; the domain's StoredCheckpoint has the same shape. */
export type StoredCheckpoint = z.infer<typeof storedCheckpointSchema>;

/** A stored checkpoint, or null when absent or from another shape. */
export function readCheckpoint(json: unknown): StoredCheckpoint | null {
	const parsed = storedCheckpointSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

/** The one digest of the stored prints: the loader (inputs.ts) and `fingerprints` both use it, so a change here is a change to every month_close print. */
export const sha256 = (s: string) =>
	createHash("sha256").update(s).digest("base64url");

/** Fingerprints of the fully loaded inputs up to each month, as month_close stores them. */
export function fingerprints(
	input: Pick<EngineInput, "activity" | "moneyIn" | "splits">,
	months: readonly MonthKey[],
): Map<MonthKey, string> {
	return fingerprintsWith(sha256, input, months);
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
				e.carryIn !== 0 || e.assigned !== 0 || e.activity !== 0 || e.left !== 0,
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
