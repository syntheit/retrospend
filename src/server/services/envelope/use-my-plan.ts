/**
 * Use my plan (owner N72) for money that just arrived: the targets first
 * (Fill from targets, the page's own proposal), then the rest where you
 * chose (D-owner-2026-10-22e: the rest stays visible unless you say so):
 *
 * - LEAVE (default): the rest stays Not planned yet.
 * - SAVE: the rest goes to the savings home (planning.saveHome).
 * - NEXT_MONTH: the rest is assigned ahead into next month (D22), by next
 *   month's targets as they will stand once this month's lines carry, and
 *   what is left after those goes to next month's savings home.
 *
 * Every line is listed (RC-5) and the whole plan is one batch, across both
 * months, so one undo takes it back.
 */
import { randomUUID } from "node:crypto";
import type {
	FillFromTargetsOutput,
	Money,
	RestChoice,
	RestOption,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { computeBook, type MovementEntry } from "./engine";
import { type MonthRead, monthViewIn } from "./month-read";
import { buildMonthView } from "./month-view";
import { assignPlan } from "./movement.service";
import { fillFromTargets, saveHome } from "./planning";
import type { Minor, MonthKey } from "./types";

type Line = FillFromTargetsOutput["lines"][number];

export interface PlanProposal {
	month: MonthKey;
	lines: Line[];
	/** What stays Not planned yet. */
	rest: Money;
	restChoice: RestChoice;
	restOptions: RestOption[];
}

/** Next month's targets once this month's lines carry, filled from `amount`. */
function nextMonthLines(
	read: MonthRead,
	lines: readonly Line[],
	amount: Minor,
	month: MonthKey,
): { lines: Line[]; left: Minor } {
	const { loaded } = read;
	const planned: MovementEntry[] = lines.map((l, i) => ({
		id: `plan:${i}`,
		month: l.month,
		from: null,
		to: l.envelopeId,
		minor: l.amount.minor,
	}));
	const input = {
		...loaded.input,
		movements: [...loaded.input.movements, ...planned],
	};
	const next = buildMonthView({
		book: loaded.book,
		input,
		state: computeBook(input, month),
		month,
		today: loaded.today,
		missingRates: loaded.missingRates,
	}).dto;
	const fill = fillFromTargets(next, amount);
	const out = fill.lines.filter((l) => l.amount.minor > 0);
	const home = saveHome(next);
	if (fill.rest.minor > 0 && home) {
		out.push({ envelopeId: home, month, amount: fill.rest, step: "REST" });
		return { lines: out, left: 0 };
	}
	return { lines: out, left: fill.rest.minor };
}

/** What Use my plan would assign for `amount` with the rest going to `rest`. Writes nothing. */
export function proposePlan(
	read: MonthRead,
	amount: Minor,
	rest: RestChoice = "LEAVE",
): PlanProposal {
	const view = read.dto;
	const fill = fillFromTargets(view, amount);
	const lines = fill.lines.filter((l) => l.amount.minor > 0);
	let left = fill.rest.minor;
	const option = fill.restOptions.find((o) => o.choice === rest);
	if (left > 0 && rest === "SAVE" && option?.envelopeId) {
		lines.push({
			envelopeId: option.envelopeId,
			month: view.month.key,
			amount: fill.rest,
			step: "REST",
		});
		left = 0;
	} else if (left > 0 && rest === "NEXT_MONTH" && option?.month) {
		const next = nextMonthLines(read, lines, left, option.month);
		lines.push(...next.lines);
		left = next.left;
	}
	return {
		month: view.month.key,
		lines,
		rest: { minor: left, currency: view.book.currency },
		restChoice: option ? rest : "LEAVE",
		restOptions: fill.restOptions,
	};
}

/** Proposes and writes the plan as one batch; null without a budget. */
export async function applyPlan(
	tx: Prisma.TransactionClient,
	userId: string,
	now: Date,
	choice: { amount: Minor; rest: RestChoice },
): Promise<(PlanProposal & { batchId: string | null }) | null> {
	const read = await monthViewIn(tx, userId, now);
	if (!read) return null;
	const plan = proposePlan(read, choice.amount, choice.rest);
	if (plan.lines.length === 0) return { ...plan, batchId: null };
	const batchId = randomUUID();
	await assignPlan(
		tx,
		userId,
		{
			batchId,
			items: plan.lines.map((l) => ({
				id: randomUUID(),
				envelopeId: l.envelopeId,
				month: l.month,
				amountMinor: l.amount.minor,
			})),
		},
		now,
	);
	return { ...plan, batchId };
}
