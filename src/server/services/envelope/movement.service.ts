/**
 * Movements (D28, build plan 02 §2): assign, set, move, cover, take back and
 * undo, written to the append-only ledger. Every write:
 *
 * - takes the book's advisory lock first, so two writes never both pass a
 *   cap read before either commits (concurrent assign, S15);
 * - is idempotent on client ids: a retry with the same id returns what the
 *   first call wrote, and a reused id with other content is refused;
 * - only touches the current or the next month (D22);
 * - caps moves out of an envelope at max(0, Left); SET never blocks this
 *   month and may leave an envelope negative (B5). Next month, nothing goes
 *   back to To assign beyond what was assigned there (planning.takeBackCap);
 * - returns every envelope it moved with its Left before and after, and To
 *   assign before and after (RC-5).
 *
 * Runs on the caller's transaction, so the `*.mutation.ts` wrappers preview it.
 */
import { randomUUID } from "node:crypto";
import type {
	AssignInput,
	CoverInput,
	Money,
	MoveInput,
	MovementResult,
	UndoInput,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import {
	checkEnvelope,
	checkMonth,
	lockedSnapshot,
	type NewMovement,
	type Snapshot,
	snapshot,
	Tracker,
} from "./movement-state";
import { markRulesSkipped } from "./rule.service";
import type { Minor, MonthKey } from "./types";
import { fromMinor, toMinor } from "./units";

type Tx = Prisma.TransactionClient;

const money = (s: Snapshot, minor: Minor): Money => ({
	minor,
	currency: s.loaded.book.currency,
});

/** A client id that already names another row reads as a reused id, not a crash. */
async function createRows(tx: Tx, args: Prisma.BudgetMovementCreateManyArgs) {
	try {
		await tx.budgetMovement.createMany(args);
	} catch (error) {
		if ((error as { code?: string }).code === "P2002")
			throw new EnvelopeError(
				"ID_REUSED",
				"that id was already used for another change",
			);
		throw error;
	}
	forgetMonthViews(tx);
}

export async function insert(
	tx: Tx,
	s: Snapshot,
	userId: string,
	rows: NewMovement[],
) {
	if (rows.length === 0) return;
	await createRows(tx, {
		data: rows.map((r) => ({
			id: r.id,
			bookId: s.loaded.row.id,
			month: r.month,
			fromEnvelopeId: r.from,
			toEnvelopeId: r.to,
			amount: fromMinor(r.minor, s.loaded.book.currency).toString(),
			kind: r.kind,
			batchId: r.batchId,
			revertsId: r.revertsId ?? null,
			actorUserId: userId,
		})),
	});
}

type StoredMovement = Awaited<
	ReturnType<Tx["budgetMovement"]["findMany"]>
>[number];

function toResultRows(
	rows: StoredMovement[],
	currency: string,
): MovementResult["movements"] {
	return rows.map((r) => ({
		id: r.id,
		month: r.month,
		from: r.fromEnvelopeId,
		to: r.toEnvelopeId,
		amount: { minor: toMinor(r.amount.toString(), currency), currency },
		kind: r.kind,
		batchId: r.batchId,
		revertsId: r.revertsId,
		createdAt: r.createdAt,
	}));
}

/** Reads back what was written and how it moved each envelope and To assign. */
export async function result(
	tx: Tx,
	userId: string,
	now: Date,
	before: Snapshot,
	ids: string[],
): Promise<MovementResult> {
	const stored = await tx.budgetMovement.findMany({
		where: { id: { in: ids } },
		orderBy: { id: "asc" },
	});
	const after = await snapshot(tx, userId, now);
	const touched = new Map<string, MonthKey>();
	for (const r of stored) {
		if (r.fromEnvelopeId) touched.set(r.fromEnvelopeId, r.month);
		if (r.toEnvelopeId) touched.set(r.toEnvelopeId, r.month);
	}
	return {
		movements: toResultRows(stored, before.loaded.book.currency),
		envelopes: [...touched].map(([id, month]) => ({
			id,
			before: money(before, before.left(id, month)),
			after: money(after, after.left(id, month)),
		})),
		toAssign: {
			before: money(before, before.toAssign),
			after: money(after, after.toAssign),
		},
	};
}

/** A retry of a write already made: the same ids with the same content, or a refusal. */
export async function replay(
	tx: Tx,
	userId: string,
	now: Date,
	s: Snapshot,
	where: Prisma.BudgetMovementWhereInput,
	matches: (rows: StoredMovement[]) => boolean,
) {
	const existing = await tx.budgetMovement.findMany({
		where: { ...where, bookId: s.loaded.row.id },
	});
	if (existing.length === 0) return null;
	if (!matches(existing))
		throw new EnvelopeError(
			"ID_REUSED",
			"that id was already used for another change",
		);
	return result(
		tx,
		userId,
		now,
		s,
		existing.map((x) => x.id),
	);
}

const sameRow = (x: StoredMovement, e: NewMovement, currency: string) =>
	x.id === e.id &&
	x.month === e.month &&
	x.fromEnvelopeId === e.from &&
	x.toEnvelopeId === e.to &&
	x.kind === e.kind &&
	toMinor(x.amount.toString(), currency) === e.minor;

/** Rows a batch wrote match its items: same envelope, month and kind; for add, the same signed amount. */
function matchesAssign(input: AssignInput, currency: string) {
	return (rows: StoredMovement[]) =>
		rows.every((x) => {
			const item = input.items.find((i) => i.id === x.id);
			if (!item || x.month !== input.month) return false;
			if (
				x.fromEnvelopeId !== item.envelopeId &&
				x.toEnvelopeId !== item.envelopeId
			)
				return false;
			if (input.mode === "set") return x.kind === "SET";
			const back = item.amountMinor < 0;
			return (
				x.kind === (back ? "UNASSIGN" : "ASSIGN") &&
				(back ? x.fromEnvelopeId : x.toEnvelopeId) === item.envelopeId &&
				toMinor(x.amount.toString(), currency) === Math.abs(item.amountMinor)
			);
		});
}

function assignRows(input: AssignInput, s: Snapshot): NewMovement[] {
	const t = new Tracker(s);
	const next = input.month > s.current;
	const rows: NewMovement[] = [];
	for (const item of input.items) {
		checkEnvelope(item.envelopeId, s);
		const e = item.envelopeId;
		const delta =
			input.mode === "set"
				? item.amountMinor - t.assigned(e, input.month)
				: item.amountMinor;
		if (delta === 0) continue;
		const takesBack = delta < 0;
		const row: NewMovement = {
			id: item.id,
			month: input.month,
			from: takesBack ? e : null,
			to: takesBack ? null : e,
			minor: Math.abs(delta),
			kind: input.mode === "set" ? "SET" : takesBack ? "UNASSIGN" : "ASSIGN",
			batchId: input.batchId,
		};
		// SET never blocks this month (B5); next month it may not hand back carried money.
		if (takesBack && (input.mode === "add" || next)) t.check(row);
		t.apply(row);
		rows.push(row);
	}
	return rows;
}

export async function assign(
	tx: Tx,
	userId: string,
	input: AssignInput,
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const again = await replay(
		tx,
		userId,
		now,
		s,
		{ batchId: input.batchId },
		matchesAssign(input, s.loaded.book.currency),
	);
	if (again) return again;
	checkMonth(input.month, s);
	const rows = assignRows(input, s);
	await insert(tx, s, userId, rows);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}

export interface PlanItem {
	id: string;
	envelopeId: string;
	month: MonthKey;
	/** Positive: a plan only adds. */
	amountMinor: Minor;
}

/**
 * One plan as one batch across the current and the next month (Use my plan
 * with "Next month", D22), so a single undo takes all of it back. Adds only:
 * nothing is capped.
 */
export async function assignPlan(
	tx: Tx,
	userId: string,
	input: { batchId: string; items: readonly PlanItem[] },
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const currency = s.loaded.book.currency;
	const rows: NewMovement[] = input.items.map((i) => ({
		id: i.id,
		month: i.month,
		from: null,
		to: i.envelopeId,
		minor: i.amountMinor,
		kind: "ASSIGN",
		batchId: input.batchId,
	}));
	const again = await replay(
		tx,
		userId,
		now,
		s,
		{ batchId: input.batchId },
		(stored) =>
			stored.length === rows.length &&
			stored.every((x) => rows.some((r) => sameRow(x, r, currency))),
	);
	if (again) return again;
	for (const r of rows) {
		if (r.minor <= 0) throw new EnvelopeError("INVALID", "a plan only adds");
		checkMonth(r.month, s);
		checkEnvelope(r.to as string, s);
	}
	await insert(tx, s, userId, rows);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}

function moveRow(input: MoveInput, s: Snapshot): NewMovement {
	if (input.from === input.to)
		throw new EnvelopeError("INVALID", "pick two different places");
	if (input.kind === "UNASSIGN" && (input.from === null || input.to !== null))
		throw new EnvelopeError(
			"INVALID",
			"take back moves money from an envelope to the pool",
		);
	if (input.kind === "COVER" && input.to === null)
		throw new EnvelopeError("INVALID", "cover moves money into an envelope");
	if (input.kind === "MOVE" && (input.from === null || input.to === null))
		throw new EnvelopeError("INVALID", "move runs between two envelopes");
	for (const id of [input.from, input.to]) if (id) checkEnvelope(id, s);
	const row: NewMovement = {
		id: input.id,
		month: input.month,
		from: input.from,
		to: input.to,
		minor: input.amountMinor,
		kind: input.kind,
		batchId: null,
	};
	new Tracker(s).check(row);
	return row;
}

export async function move(
	tx: Tx,
	userId: string,
	input: MoveInput,
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const row: NewMovement = {
		id: input.id,
		month: input.month,
		from: input.from,
		to: input.to,
		minor: input.amountMinor,
		kind: input.kind,
		batchId: null,
	};
	const currency = s.loaded.book.currency;
	const again = await replay(tx, userId, now, s, { id: input.id }, (rows) =>
		rows.every((x) => sameRow(x, row, currency)),
	);
	if (again) return again;
	checkMonth(input.month, s);
	const built = moveRow(input, s);
	await insert(tx, s, userId, [built]);
	return result(tx, userId, now, s, [built.id]);
}

/** Cover an overspent envelope (SPEC §6.5): a COVER move into it from To assign or another envelope. */
export function cover(
	tx: Tx,
	userId: string,
	input: CoverInput,
	now: Date,
): Promise<MovementResult> {
	return move(
		tx,
		userId,
		{
			id: input.id,
			month: input.month,
			from: input.from,
			to: input.envelopeId,
			amountMinor: input.amountMinor,
			kind: "COVER",
		},
		now,
	);
}

/** Appends mirror rows for one movement or a whole batch; a batch undoes as one (D28). */
export async function undo(
	tx: Tx,
	userId: string,
	input: UndoInput,
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const where =
		"movementId" in input.target
			? { id: input.target.movementId }
			: { batchId: input.target.batchId };
	const originals = await tx.budgetMovement.findMany({
		where: { ...where, bookId: s.loaded.row.id },
	});
	const ids = new Set(originals.map((o) => o.id));
	const again = await replay(
		tx,
		userId,
		now,
		s,
		{ batchId: input.id },
		(rows) =>
			rows.every(
				(x) =>
					x.kind === "UNDO" && x.revertsId !== null && ids.has(x.revertsId),
			),
	);
	if (again) return again;
	if (originals.length === 0)
		throw new EnvelopeError("NOT_FOUND", "nothing to undo");
	if (originals.some((o) => o.kind === "UNDO"))
		throw new EnvelopeError("INVALID", "an undo cannot be undone");
	const undone = await tx.budgetMovement.count({
		where: { revertsId: { in: originals.map((o) => o.id) } },
	});
	if (undone > 0)
		throw new EnvelopeError("ALREADY_UNDONE", "that change was already undone");
	for (const o of originals) checkMonth(o.month, s);
	const rows: NewMovement[] = originals.map((o) => ({
		id: randomUUID(),
		month: o.month,
		from: o.toEnvelopeId,
		to: o.fromEnvelopeId,
		minor: toMinor(o.amount.toString(), s.loaded.book.currency),
		kind: "UNDO",
		batchId: input.id,
		revertsId: o.id,
	}));
	// An exact mirror, but next month it may not hand carried money back to To assign.
	const t = new Tracker(s);
	for (const r of rows) {
		if (r.to === null && r.month > s.current) t.check(r);
		t.apply(r);
	}
	await insert(tx, s, userId, rows);
	// An undone rule batch marks its money in "rules skipped" (SPEC §5.10).
	await markRulesSkipped(
		tx,
		s.loaded.row.id,
		originals.flatMap((o) =>
			o.kind === "RULE" && o.sourceExpenseId ? [o.sourceExpenseId] : [],
		),
	);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}
