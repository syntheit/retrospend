/**
 * Plan next month and What if (SPEC §5.13, B4, D2, D54, owner r5 Q1).
 *
 * - A draft is saved, previewed and discarded without moving money.
 *   Expected money in and pretend rows are never written anywhere else.
 * - Apply on a plan saves it as the month's plan and moves nothing: this
 *   month's Not planned yet and Left to spend stay as they are. When the
 *   month comes and money arrives, Use my plan starts from it.
 * - "Fund it now from what I have" assigns the plan's missing part into
 *   next month from this month's positive To assign, as one PLAN_APPLY
 *   batch with undo.
 * - Apply on a What if writes only its moves, as one PLAN_APPLY batch, each
 *   capped at what its source envelope really holds (S15).
 * - A draft whose month is no longer the current or next one is stale: it
 *   previews as stale and cannot be applied.
 */
import { randomUUID } from "node:crypto";
import type { MovementResult } from "~/lib/schemas/envelope";
import type {
	ApplyDraftInput,
	DraftDto,
	DraftKind,
	DraftPreview,
	DraftResult,
	DraftsOutput,
	FundNowInput,
	PlanFillInput,
	PlanFillOutput,
	SaveDraftInput,
} from "~/lib/schemas/envelope-plan";
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { fundNowLines, previewDraft } from "./draft-preview";
import { savedPlan, toDraftDto } from "./draft-store";
import { EnvelopeError } from "./errors";
import { forgetMonthViews, type MonthRead, monthViewIn } from "./month-read";
import { insert, replay, result } from "./movement.service";
import {
	checkEnvelope,
	lockedSnapshot,
	type NewMovement,
	type Snapshot,
	Tracker,
} from "./movement-state";
import { activeRules, runPendingRules } from "./rule.service";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

async function currentRead(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<MonthRead> {
	const read = await monthViewIn(tx, userId, now);
	if (!read) throw new EnvelopeError("NO_BOOK", "start a budget first");
	return read;
}

/** PLAN drafts are for next month; What if for this month or the next. */
function monthAllowed(kind: DraftKind, month: MonthKey, c: MonthKey) {
	return kind === "PLAN"
		? month === addMonths(c, 1)
		: month === c || month === addMonths(c, 1);
}

async function ownDraft(tx: Tx, bookId: string, draftId: string) {
	const d = await tx.budgetDraft.findFirst({ where: { id: draftId, bookId } });
	if (!d) throw new EnvelopeError("NOT_FOUND", "no such draft");
	return d;
}

async function checkRefs(tx: Tx, read: MonthRead, input: SaveDraftInput) {
	const live = new Set(
		read.loaded.book.envelopes.filter((e) => !e.archived).map((e) => e.id),
	);
	const envs = [
		...input.lines.map((l) => l.envelopeId),
		...input.moves.flatMap((m) => [m.from, m.to]),
		...input.pretend.map((p) => p.envelopeId),
	].filter((x): x is string => x !== null);
	if (envs.some((e) => !live.has(e)))
		invalid("a draft names an unknown or archived envelope");
	if (input.moves.some((m) => m.from === m.to))
		invalid("a move runs between two places");
	const cats = [
		...new Set(
			[...input.expectedIn, ...input.pretend].flatMap((x) =>
				x.categoryId ? [x.categoryId] : [],
			),
		),
	];
	// RLS shows only the user's own categories.
	if (
		cats.length &&
		(await tx.category.count({ where: { id: { in: cats } } })) !== cats.length
	)
		invalid("a draft names an unknown category");
}

/**
 * Creates or edits the open draft (moves no money). A new What if discards
 * the open one for its month; a new plan is refused while another plan is
 * open for the month, so a client that never read it cannot wipe it.
 */
export async function saveDraft(
	tx: Tx,
	userId: string,
	input: SaveDraftInput,
	now: Date,
): Promise<DraftDto> {
	const read = await currentRead(tx, userId, now);
	const bookId = read.loaded.row.id;
	if (!monthAllowed(input.kind, input.month, read.loaded.input.currentMonth))
		invalid(
			input.kind === "PLAN"
				? "a plan is for next month"
				: "What if is for this month or the next",
		);
	await checkRefs(tx, read, input);
	const existing = await tx.budgetDraft.findUnique({ where: { id: input.id } });
	if (
		existing &&
		(existing.bookId !== bookId ||
			existing.kind !== input.kind ||
			existing.month !== input.month)
	)
		throw new EnvelopeError(
			"ID_REUSED",
			"that id was already used for another draft",
		);
	if (existing && existing.status !== "OPEN")
		invalid("that draft was already applied or discarded");
	const data = {
		lines: input.lines,
		moves: input.moves,
		expectedIn: input.expectedIn,
		pretend: input.pretend,
	};
	if (existing)
		return toDraftDto(
			await tx.budgetDraft.update({ where: { id: input.id }, data }),
		);
	// A plan is edited by its id. A new id while another plan is open for the
	// month means the client never read that plan, so its save would wipe it.
	if (
		input.kind === "PLAN" &&
		(await tx.budgetDraft.count({
			where: { bookId, month: input.month, kind: "PLAN", status: "OPEN" },
		})) > 0
	)
		throw new EnvelopeError(
			"DRAFT_OPEN",
			"another plan is open for that month; save it by its id",
		);
	await tx.budgetDraft.updateMany({
		where: { bookId, month: input.month, kind: input.kind, status: "OPEN" },
		data: { status: "DISCARDED" },
	});
	return toDraftDto(
		await tx.budgetDraft.create({
			data: {
				id: input.id,
				bookId,
				month: input.month,
				kind: input.kind,
				createdById: userId,
				...data,
			},
		}),
	);
}

export async function discardDraft(
	tx: Tx,
	userId: string,
	draftId: string,
	now: Date,
): Promise<DraftDto> {
	const read = await currentRead(tx, userId, now);
	const d = await ownDraft(tx, read.loaded.row.id, draftId);
	if (d.status === "DISCARDED") return toDraftDto(d);
	return toDraftDto(
		await tx.budgetDraft.update({
			where: { id: d.id },
			data: { status: "DISCARDED" },
		}),
	);
}

/** The open draft of a kind for a month (default: next month for a plan, this month for What if), and the saved plan. */
export async function getDrafts(
	tx: Tx,
	userId: string,
	p: { kind: DraftKind; month?: MonthKey },
	now: Date,
): Promise<DraftsOutput> {
	const read = await currentRead(tx, userId, now);
	const c = read.loaded.input.currentMonth;
	const month = p.month ?? (p.kind === "PLAN" ? addMonths(c, 1) : c);
	const bookId = read.loaded.row.id;
	const open = await tx.budgetDraft.findFirst({
		where: { bookId, month, kind: p.kind, status: "OPEN" },
	});
	const saved = p.kind === "PLAN" ? await savedPlan(tx, bookId, month) : null;
	return {
		month,
		open: open ? toDraftDto(open) : null,
		saved: saved ? toDraftDto(saved) : null,
	};
}

/** What the draft would do; reads only. A stale draft previews as stale with no lines. */
export async function previewDraftIn(
	tx: Tx,
	userId: string,
	draftId: string,
	now: Date,
): Promise<DraftPreview> {
	await runPendingRules(tx, userId, now);
	const read = await currentRead(tx, userId, now);
	const draft = toDraftDto(await ownDraft(tx, read.loaded.row.id, draftId));
	const H = read.loaded.book.currency;
	if (!monthAllowed(draft.kind, draft.month, read.loaded.input.currentMonth)) {
		const zero = { minor: 0, currency: H };
		return {
			draftId,
			kind: draft.kind,
			month: draft.month,
			toAssign: { before: zero, after: zero },
			envelopes: [],
			ruleLines: [],
			shortfalls: [],
			fundNow: null,
			incomplete: false,
			stale: true,
		};
	}
	const base = await monthViewIn(tx, userId, now, draft.month);
	return previewDraft({
		loaded: read.loaded,
		base: (base as MonthRead).dto,
		current: read.dto,
		draft,
		rules: await activeRules(tx, read.loaded.row.id, H),
		nowMs: now.getTime(),
	});
}

/** "Fill from targets", "Same as this month", "What this month spent" for next month's plan (SPEC §5.13). */
export async function planFill(
	tx: Tx,
	userId: string,
	input: PlanFillInput,
	now: Date,
): Promise<PlanFillOutput> {
	const read = await currentRead(tx, userId, now);
	const next = addMonths(read.loaded.input.currentMonth, 1);
	const source =
		input.source === "TARGETS"
			? ((await monthViewIn(tx, userId, now, next)) as MonthRead).dto
			: read.dto;
	const rows = source.groups.flatMap((g) => g.envelopes);
	const lines = rows.flatMap((r) => {
		const amount =
			input.source === "TARGETS"
				? r.assigned.minor + (r.target?.need.minor ?? 0)
				: input.source === "SAME_AS_THIS_MONTH"
					? r.assigned.minor
					: Math.max(0, -r.activity.minor);
		return amount > 0 ? [{ envelopeId: r.id, amountMinor: amount }] : [];
	});
	return { month: next, lines };
}

function stale(): never {
	throw new EnvelopeError("MONTH_CLOSED", "that draft's month has passed");
}

/** Writes rows as one PLAN_APPLY batch (idempotent on the batch id). */
async function writeBatch(
	tx: Tx,
	userId: string,
	now: Date,
	s: Snapshot,
	batchId: string,
	rows: NewMovement[],
): Promise<MovementResult | null> {
	const again = await replay(tx, userId, now, s, { batchId }, (stored) =>
		stored.every((x) => x.kind === "PLAN_APPLY"),
	);
	if (again) return again;
	if (rows.length === 0) return null;
	await insert(tx, s, userId, rows);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}

async function applyPlanDraft(
	tx: Tx,
	bookId: string,
	d: DraftDto,
	now: Date,
): Promise<DraftResult> {
	if (d.status === "APPLIED")
		return { draft: d, supersededId: null, movement: null };
	const prior = await savedPlan(tx, bookId, d.month);
	if (prior)
		await tx.budgetDraft.update({
			where: { id: prior.id },
			data: { status: "DISCARDED" },
		});
	const row = await tx.budgetDraft.update({
		where: { id: d.id },
		data: {
			status: "APPLIED",
			appliedAt: now,
			supersedesId: prior?.id ?? null,
		},
	});
	return {
		draft: toDraftDto(row),
		supersededId: prior?.id ?? null,
		movement: null,
	};
}

async function applyWhatIf(
	tx: Tx,
	userId: string,
	s: Snapshot,
	d: DraftDto,
	batchId: string,
	now: Date,
): Promise<DraftResult> {
	const t = new Tracker(s);
	// Pretend money in never funds a real move: out of To assign, at most what it really holds.
	let pool = Math.max(0, s.toAssign);
	const rows: NewMovement[] = d.moves.map((m) => {
		for (const id of [m.from, m.to]) if (id) checkEnvelope(id, s);
		if (m.from === null) {
			if (m.amountMinor > pool)
				throw new EnvelopeError(
					"OVER_CAP",
					"that is more than Not planned yet holds",
					pool,
				);
			pool -= m.amountMinor;
		}
		if (m.to === null) pool += m.amountMinor;
		const row: NewMovement = {
			id: m.id,
			month: d.month,
			from: m.from,
			to: m.to,
			minor: m.amountMinor,
			kind: "PLAN_APPLY",
			batchId,
		};
		// Real money only: a move takes at most what its source holds now (S15).
		t.check(row);
		t.apply(row);
		return row;
	});
	const movement = await writeBatch(tx, userId, now, s, batchId, rows);
	const row = await tx.budgetDraft.update({
		where: { id: d.id },
		data: {
			status: "APPLIED",
			appliedAt: now,
			fundedBatchId: movement ? batchId : null,
		},
	});
	return { draft: toDraftDto(row), supersededId: null, movement };
}

/** Apply (SPEC §5.13): a plan is saved and moves nothing; a What if writes only its moves. */
export async function applyDraft(
	tx: Tx,
	userId: string,
	input: ApplyDraftInput,
	now: Date,
): Promise<DraftResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const d = toDraftDto(await ownDraft(tx, s.loaded.row.id, input.draftId));
	if (d.status === "DISCARDED") invalid("that draft was discarded");
	if (!monthAllowed(d.kind, d.month, s.current)) stale();
	if (d.kind === "PLAN") return applyPlanDraft(tx, s.loaded.row.id, d, now);
	if (!input.batchId) invalid("What if needs a batch id for its moves");
	if (d.status === "APPLIED" && d.fundedBatchId !== input.batchId)
		invalid("that What if was already applied");
	const out = await applyWhatIf(tx, userId, s, d, input.batchId, now);
	forgetMonthViews(tx);
	return out;
}

/** Undo of a plan's Apply: the plan is a draft again and the plan it replaced is back. */
export async function unapplyDraft(
	tx: Tx,
	userId: string,
	draftId: string,
	now: Date,
): Promise<DraftResult> {
	const read = await currentRead(tx, userId, now);
	const d = await ownDraft(tx, read.loaded.row.id, draftId);
	if (d.kind !== "PLAN" || d.status !== "APPLIED")
		invalid("only a saved plan can be taken back");
	const open = await tx.budgetDraft.count({
		where: { bookId: d.bookId, month: d.month, kind: "PLAN", status: "OPEN" },
	});
	const row = await tx.budgetDraft.update({
		where: { id: d.id },
		data: {
			status: open ? "DISCARDED" : "OPEN",
			appliedAt: null,
			supersedesId: null,
		},
	});
	if (d.supersedesId)
		await tx.budgetDraft.update({
			where: { id: d.supersedesId },
			data: { status: "APPLIED" },
		});
	return {
		draft: toDraftDto(row),
		supersededId: d.supersedesId,
		movement: null,
	};
}

/** "Fund it now from what I have": next month's missing plan lines from this month's positive To assign. */
export async function fundNow(
	tx: Tx,
	userId: string,
	input: FundNowInput,
	now: Date,
): Promise<DraftResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const d = toDraftDto(await ownDraft(tx, s.loaded.row.id, input.draftId));
	if (d.kind !== "PLAN" || d.status === "DISCARDED")
		invalid("only a plan can be funded");
	const next = addMonths(s.current, 1);
	if (d.month !== next) stale();
	const nextView = ((await monthViewIn(tx, userId, now, next)) as MonthRead)
		.dto;
	const rows: NewMovement[] = fundNowLines(d.lines, nextView, s.toAssign).map(
		(l) => ({
			id: randomUUID(),
			month: next,
			from: null,
			to: l.envelopeId,
			minor: l.amount,
			kind: "PLAN_APPLY",
			batchId: input.batchId,
		}),
	);
	const movement = await writeBatch(tx, userId, now, s, input.batchId, rows);
	const row = await tx.budgetDraft.update({
		where: { id: d.id },
		data: { fundedBatchId: movement ? input.batchId : d.fundedBatchId },
	});
	forgetMonthViews(tx);
	return { draft: toDraftDto(row), supersededId: null, movement };
}
