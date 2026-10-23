/**
 * What a draft would do (SPEC §5.13, B4, D54): the engine runs the month
 * with the draft's rows as virtual inputs and compares it with the month as
 * it stands. Pure, and nothing here writes: expected money in, pretend
 * expenses and pretend money in exist only inside this pass.
 *
 * - Expected and pretend money in raise the month's To assign, and the
 *   income rules are previewed on them (as on a real money in created now;
 *   a TITLE rule never matches, a draft has no titles).
 * - A plan line sets the envelope's Assigned for the month: the virtual move
 *   is the difference from what it has now.
 * - Pretend expenses lower Activity in their category's envelope (or the
 *   one named); pretend moves move money between envelopes.
 * - Envelopes the draft leaves below 0 (or further below) are short, each
 *   with a suggested cover from the month's cover sources.
 */
import type { GetMonthOutput, Money } from "~/lib/schemas/envelope";
import type { DraftDto, DraftPreview } from "~/lib/schemas/envelope-plan";
import {
	type ActivityEntry,
	computeBook,
	type EngineInput,
	type MoneyInEntry,
	type MovementEntry,
} from "./engine";
import type { LoadedBook } from "./inputs";
import { buildMonthView } from "./month-view";
import { coverSources } from "./planning";
import { allocateRules, type IncomeRule } from "./rules";
import type { Minor, MonthKey } from "./types";

type Row = GetMonthOutput["groups"][number]["envelopes"][number];

const rowsOf = (v: GetMonthOutput): Row[] => v.groups.flatMap((g) => g.envelopes);

export interface DraftRun {
	input: EngineInput;
	ruleLines: DraftPreview["ruleLines"];
}

/** The draft's rows as engine inputs for its month, on top of the loaded book. */
export function draftInput(
	loaded: LoadedBook,
	base: GetMonthOutput,
	draft: DraftDto,
	rules: readonly IncomeRule[],
	nowMs: number,
): DraftRun {
	const m = draft.month;
	const H = loaded.book.currency;
	const moneyIn: MoneyInEntry[] = [];
	const movements: MovementEntry[] = [];
	const activity: ActivityEntry[] = [];
	const ruleLines: DraftRun["ruleLines"] = [];
	const ins = [
		...draft.expectedIn.map((x) => ({ ...x, envelopeId: null })),
		...draft.pretend.filter((p) => p.kind === "IN").map((p) => ({ ...p, templateId: null })),
	];
	for (const x of ins) {
		moneyIn.push({ id: `draft:${x.id}`, month: m, minor: x.amountMinor, source: "INCOME" });
		const lines = allocateRules(
			{
				id: x.id,
				direction: "IN",
				entryKind: "STANDARD",
				inType: "INCOME",
				keptInWealth: false,
				categoryId: x.categoryId,
				templateId: x.templateId,
				title: "",
				currency: H,
				bookValue: x.amountMinor,
				createdAtMs: nowMs,
			},
			rules,
		);
		for (const [i, l] of lines.entries()) {
			movements.push({ id: `draft-rule:${x.id}:${i}`, month: m, from: null, to: l.envelopeId, minor: l.amount });
			ruleLines.push({ sourceId: x.id, ruleId: l.ruleId, envelopeId: l.envelopeId, amount: { minor: l.amount, currency: H } });
		}
	}
	const assigned = new Map(rowsOf(base).map((r) => [r.id, r.assigned.minor]));
	for (const l of draft.lines) {
		const delta = l.amountMinor - (assigned.get(l.envelopeId) ?? 0);
		if (delta === 0) continue;
		movements.push({
			id: `draft-plan:${l.envelopeId}`,
			month: m,
			from: delta < 0 ? l.envelopeId : null,
			to: delta < 0 ? null : l.envelopeId,
			minor: Math.abs(delta),
		});
	}
	for (const mv of draft.moves)
		movements.push({ id: `draft-move:${mv.id}`, month: m, from: mv.from, to: mv.to, minor: mv.amountMinor });
	const date = m === loaded.input.currentMonth ? loaded.today : base.month.from;
	for (const p of draft.pretend.filter((x) => x.kind === "OUT"))
		activity.push({
			id: `draft:${p.id}`,
			month: m,
			date,
			minor: -p.amountMinor,
			source: "SPENT",
			categoryId: p.categoryId,
			envelopeId: p.envelopeId,
		});
	return {
		input: {
			...loaded.input,
			moneyIn: [...loaded.input.moneyIn, ...moneyIn],
			movements: [...loaded.input.movements, ...movements],
			activity: [...loaded.input.activity, ...activity],
		},
		ruleLines,
	};
}

/** Covers each short envelope from the month's sources, largest tier first, never spending a source twice. */
function shortfalls(
	before: GetMonthOutput,
	after: GetMonthOutput,
): DraftPreview["shortfalls"] {
	const H = after.book.currency;
	const was = new Map(rowsOf(before).map((r) => [r.id, r.left.minor]));
	const used = new Map<string, Minor>();
	const out: DraftPreview["shortfalls"] = [];
	for (const r of rowsOf(after)) {
		const left = r.left.minor;
		if (left >= 0 || left >= (was.get(r.id) ?? 0)) continue;
		let need = -left;
		const cover: Array<{ from: string | null; amount: Money }> = [];
		for (const s of coverSources(after, r.id)) {
			const key = s.from ?? "";
			const free = s.available.minor - (used.get(key) ?? 0);
			const take = Math.min(need, Math.max(0, free));
			if (take <= 0) continue;
			used.set(key, (used.get(key) ?? 0) + take);
			cover.push({ from: s.from, amount: { minor: take, currency: H } });
			need -= take;
			if (need === 0) break;
		}
		out.push({
			envelopeId: r.id,
			short: { minor: -left, currency: H },
			cover,
			uncovered: { minor: need, currency: H },
		});
	}
	return out;
}

/**
 * "Fund it now from what I have" (owner r5 Q1): each plan line's missing
 * part in plan order, from this month's positive To assign only, so it
 * never makes To assign negative. The rest waits for next month's money.
 */
export function fundNowLines(
	lines: DraftDto["lines"],
	next: GetMonthOutput,
	pool: Minor,
): Array<{ envelopeId: string; amount: Minor }> {
	const assigned = new Map(rowsOf(next).map((r) => [r.id, r.assigned.minor]));
	let left = Math.max(0, pool);
	const out: Array<{ envelopeId: string; amount: Minor }> = [];
	for (const l of lines) {
		if (!assigned.has(l.envelopeId)) continue;
		const amount = Math.min(left, Math.max(0, l.amountMinor - (assigned.get(l.envelopeId) ?? 0)));
		if (amount <= 0) continue;
		out.push({ envelopeId: l.envelopeId, amount });
		left -= amount;
	}
	return out;
}

const pair = (before: Money, after: Money) => ({ before, after });

/** The draft's preview for its month (`base` is that month as it stands, `current` this month). */
export function previewDraft(p: {
	loaded: LoadedBook;
	base: GetMonthOutput;
	current: GetMonthOutput;
	draft: DraftDto;
	rules: readonly IncomeRule[];
	nowMs: number;
}): DraftPreview {
	const run = draftInput(p.loaded, p.base, p.draft, p.rules, p.nowMs);
	const m: MonthKey = p.draft.month;
	const after = buildMonthView({
		book: p.loaded.book,
		input: run.input,
		state: computeBook(run.input, m),
		month: m,
		today: p.loaded.today,
		missingRates: p.loaded.missingRates,
	}).dto;
	const before = new Map(rowsOf(p.base).map((r) => [r.id, r]));
	const envelopes = rowsOf(after).flatMap((a) => {
		const b = before.get(a.id);
		if (!b) return [];
		const moved =
			a.assigned.minor !== b.assigned.minor ||
			a.activity.minor !== b.activity.minor ||
			a.left.minor !== b.left.minor;
		if (!moved) return [];
		return [
			{
				envelopeId: a.id,
				assigned: pair(b.assigned, a.assigned),
				activity: pair(b.activity, a.activity),
				left: pair(b.left, a.left),
				need: a.target?.need ?? { minor: 0, currency: a.left.currency },
				short: a.left.minor < 0,
			},
		];
	});
	const H = p.loaded.book.currency;
	const fund =
		p.draft.kind === "PLAN"
			? fundNowLines(p.draft.lines, p.base, p.current.toAssign.amount.minor).reduce(
					(s, l) => s + l.amount,
					0,
				)
			: null;
	return {
		draftId: p.draft.id,
		kind: p.draft.kind,
		month: m,
		toAssign: pair(p.base.toAssign.amount, after.toAssign.amount),
		envelopes,
		ruleLines: run.ruleLines,
		shortfalls: shortfalls(p.base, after),
		fundNow: fund === null ? null : { minor: fund, currency: H },
		incomplete: after.incomplete,
		stale: false,
	};
}
