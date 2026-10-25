/**
 * What a month closes with (SPEC §5.5 step 3, 02 §2): per envelope its
 * carry-in, assigned, activity and Left, the leftover rule it closed under
 * and what that rule did, the overspend next month's To assign takes, and
 * what was held for others per person and currency (D9). Pure: the close
 * service writes it as `month_close.summary`, and the engine reads the rules
 * back so a rule changed later applies from the next close only (B7).
 */
import type { MonthCloseSummary } from "~/lib/schemas/envelope";
import { type BookState, type EngineInput, ruleAtClose } from "./engine";
import { type ReplayEvent, replaySplits } from "./splits-replay";
import type { MonthKey } from "./types";

export interface CloseInput {
	input: EngineInput;
	state: BookState;
	month: MonthKey;
	currency: string;
	/** Every splits replay event; the ones up to `month` give what was held then. */
	events: readonly ReplayEvent[];
}

function heldAt(events: readonly ReplayEvent[], month: MonthKey) {
	return replaySplits(events.filter((e) => e.month <= month))
		.balances.filter((b) => b.native > 0)
		.map((b) => ({
			counterparty: b.counterparty,
			currency: b.currency,
			native: b.native,
			held: b.basis,
		}));
}

export function closeSummary(p: CloseInput): MonthCloseSummary {
	const s = p.state.month(p.month);
	const snapshot = p.input.closedRules?.get(p.month);
	const envelopes = p.input.envelopes.map((e) => {
		const m = s.envelopes.get(e.id);
		const left = m?.left ?? 0;
		const pos = Math.max(0, left);
		const { rule, sweepToId } = snapshot?.get(e.id) ?? ruleAtClose(e);
		return {
			id: e.id,
			carryIn: m?.carryIn ?? 0,
			assigned: m?.assigned ?? 0,
			activity: m?.activity ?? 0,
			left,
			rule,
			sweepToId: rule === "SWEEP" ? sweepToId : null,
			carried: rule === "CARRY" ? pos : 0,
			returned: rule === "RETURN" ? pos : 0,
			swept: rule === "SWEEP" ? pos : 0,
			overspent: Math.max(0, -left),
		};
	});
	return {
		month: p.month,
		currency: p.currency,
		moneyIn: s.totals.moneyIn,
		assigned: s.totals.assigned,
		overspent: s.totals.overspent,
		returned: s.totals.returned,
		held: heldAt(p.events, p.month),
		envelopes,
		links: linksAt(p.input, p.month),
	};
}

/** The routing a month closes with: the one it already closed with, else today's links. */
function linksAt(input: EngineInput, month: MonthKey): Record<string, string> {
	const kept = input.closedLinks?.get(month);
	if (kept) return Object.fromEntries(kept);
	const out: Record<string, string> = {};
	for (const e of input.envelopes) for (const c of e.categoryIds) out[c] = e.id;
	return out;
}
