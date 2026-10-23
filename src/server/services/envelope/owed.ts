/**
 * Money owed, as the budget sees it (SPEC §5.8, §6.9; 02 §5.2 `owed`): what
 * is out with each person and what the budget holds for it, from the splits
 * replay. Pure.
 *
 * - Per person and currency: the open balance (positive: they owe you;
 *   negative: you owe them) and the book value held for it.
 * - Pending: payments to you not yet confirmed (D8), shown, never counted.
 * - Age (C15): days since the oldest part still owed started (first in,
 *   first out). After 60 days with no payment from them in 60 days, the
 *   person is aging: one Needs you item with Remind or Forgive.
 * - Projects you count "Not in budget" are listed, never counted.
 */
import type { Money, OwedDto, OwedSummaryDto } from "~/lib/schemas/envelope";
import { daysBetween } from "./calendar";
import type { PendingReceipt } from "./split-events";
import type { ReplayEvent, ReplayResult } from "./splits-replay";
import type { IsoDate, Minor } from "./types";

/** Days an open balance may wait before it asks for Remind or Forgive (C15). */
export const OWED_AGING_DAYS = 60;

export interface OwedInput {
	replay: ReplayResult;
	events: readonly ReplayEvent[];
	pending: readonly PendingReceipt[];
	notInBudget: ReadonlyArray<{ projectId: string; name: string }>;
	/** Book currency. */
	currency: string;
	today: IsoDate;
	names?: ReadonlyMap<string, string>;
	/** A row was left out for a missing rate. */
	incomplete: boolean;
}

type ParticipantType = "user" | "guest" | "shadow";

function participantOf(key: string): { type: ParticipantType; id: string } {
	const at = key.indexOf(":");
	return {
		type: key.slice(0, at) as ParticipantType,
		id: key.slice(at + 1),
	};
}

/** Latest payment to you that counted, per person. */
function lastPaid(events: readonly ReplayEvent[]): Map<string, IsoDate> {
	const out = new Map<string, IsoDate>();
	for (const e of events) {
		if (e.kind !== "RECV" || e.status !== "FINALIZED" || e.isOffset) continue;
		const seen = out.get(e.counterparty);
		if (!seen || e.date > seen) out.set(e.counterparty, e.date);
	}
	return out;
}

export function owedPeople(input: OwedInput): OwedDto["people"] {
	const H = input.currency;
	const money = (minor: Minor, currency = H): Money => ({ minor, currency });
	const paid = lastPaid(input.events);
	const keys = new Set([
		...input.replay.balances
			.filter((b) => b.native !== 0)
			.map((b) => b.counterparty),
		...input.pending.map((p) => p.counterparty),
	]);
	return [...keys].sort().map((key) => {
		const lines = input.replay.balances
			.filter((b) => b.counterparty === key && b.native !== 0)
			.sort((a, b) => (a.currency < b.currency ? -1 : 1))
			.map((b) => ({
				amount: money(b.native, b.currency),
				held: money(Math.max(0, b.basis)),
				oldestOpen: b.oldestOpen,
				ageDays: b.oldestOpen ? daysBetween(b.oldestOpen, input.today) : null,
			}));
		const ages = lines.flatMap((l) => (l.ageDays === null ? [] : [l.ageDays]));
		const ageDays = ages.length ? Math.max(...ages) : null;
		const lastPaidOn = paid.get(key) ?? null;
		const quiet =
			lastPaidOn === null ||
			daysBetween(lastPaidOn, input.today) >= OWED_AGING_DAYS;
		return {
			participant: participantOf(key),
			name: input.names?.get(key) ?? null,
			lines,
			held: money(lines.reduce((t, l) => t + l.held.minor, 0)),
			pending: money(
				input.pending
					.filter((p) => p.counterparty === key)
					.reduce((t, p) => t + (p.cash ?? 0), 0),
			),
			lastPaidOn,
			ageDays,
			aging: ageDays !== null && ageDays >= OWED_AGING_DAYS && quiet,
		};
	});
}

export function owedDto(input: OwedInput): OwedDto {
	const people = owedPeople(input);
	const sum = (f: (p: OwedDto["people"][number]) => Minor) =>
		people.reduce((t, p) => t + f(p), 0);
	return {
		held: { minor: sum((p) => p.held.minor), currency: input.currency },
		pending: { minor: sum((p) => p.pending.minor), currency: input.currency },
		people,
		notInBudget: [...input.notInBudget],
		incomplete: input.incomplete || input.pending.some((p) => p.cash === null),
	};
}

/** The Owed line on the Budget page: totals and counts, no names. */
export function owedSummary(input: OwedInput): OwedSummaryDto {
	const dto = owedDto(input);
	return {
		held: dto.held,
		pending: dto.pending,
		people: dto.people.filter((p) => p.held.minor > 0).length,
		aging: dto.people.filter((p) => p.aging).length,
	};
}
