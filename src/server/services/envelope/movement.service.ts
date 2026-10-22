/**
 * Movements (D28, build plan 02 §2): assign, set, move, cover, take back and
 * undo, written to the append-only ledger. Every write:
 *
 * - takes the book's advisory lock first, so two writes never both pass a
 *   cap read before either commits (concurrent assign, S15);
 * - is idempotent on client ids: a retry with the same id returns what the
 *   first call wrote, and a reused id with other content is refused;
 * - only touches the current or the next month (D22);
 * - caps moves out of an envelope at max(0, Left); SET never blocks and may
 *   leave an envelope negative (B5);
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
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { EnvelopeError } from "./errors";
import { findPersonalBook, type LoadedBook, loadBook } from "./inputs";
import type { Minor, MonthKey } from "./types";
import { fromMinor, toMinor } from "./units";

type Tx = Prisma.TransactionClient;
type Kind = "ASSIGN" | "SET" | "MOVE" | "COVER" | "UNASSIGN" | "UNDO";

interface NewMovement {
	id: string;
	month: MonthKey;
	from: string | null;
	to: string | null;
	minor: Minor;
	kind: Kind;
	batchId: string | null;
	revertsId?: string;
}

interface Snapshot {
	loaded: LoadedBook;
	left: (envelopeId: string, month: MonthKey) => Minor;
	assigned: (envelopeId: string, month: MonthKey) => Minor;
	toAssign: Minor;
	current: MonthKey;
}

/** One writer per book at a time (02 §2; month close takes the same lock in P4). */
async function lockBook(tx: Tx, bookId: string) {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget_book:${bookId}`}))`;
}

async function snapshot(tx: Tx, userId: string, now: Date): Promise<Snapshot> {
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const state = computeBook(loaded.input);
	const row = (id: string, month: MonthKey) =>
		state.month(month).envelopes.get(id);
	const c = loaded.input.currentMonth;
	return {
		loaded,
		left: (id, month) => row(id, month)?.left ?? 0,
		assigned: (id, month) => row(id, month)?.assigned ?? 0,
		toAssign: state.toAssign(c).total,
		current: c,
	};
}

/** Locks the user's book and reads it after the lock, so caps see every committed write. */
async function lockedSnapshot(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<Snapshot> {
	const book = await findPersonalBook(tx, userId);
	if (!book) throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	return snapshot(tx, userId, now);
}

function checkMonth(month: MonthKey, s: Snapshot) {
	if (month < s.current)
		throw new EnvelopeError("MONTH_CLOSED", "that month has closed");
	if (month > addMonths(s.current, 1))
		throw new EnvelopeError(
			"INVALID",
			"money can be planned for this month and the next only",
		);
}

function checkEnvelope(id: string, s: Snapshot) {
	const e = s.loaded.book.envelopes.find((x) => x.id === id);
	if (!e) throw new EnvelopeError("NOT_FOUND", "no such envelope");
	if (e.archived)
		throw new EnvelopeError("INVALID", "that envelope is archived");
}

const money = (s: Snapshot, minor: Minor): Money => ({
	minor,
	currency: s.loaded.book.currency,
});

async function insert(
	tx: Tx,
	s: Snapshot,
	userId: string,
	rows: NewMovement[],
) {
	if (rows.length === 0) return;
	await tx.budgetMovement.createMany({
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
async function result(
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

/** A retry of a write already made: same ids, same content, or a refusal. */
async function replay(
	tx: Tx,
	userId: string,
	now: Date,
	s: Snapshot,
	where: Prisma.BudgetMovementWhereInput,
	expected: NewMovement[] | null,
) {
	const existing = await tx.budgetMovement.findMany({
		where: { ...where, bookId: s.loaded.row.id },
	});
	if (existing.length === 0) return null;
	const same =
		!expected ||
		(existing.length === expected.length &&
			expected.every((e) =>
				existing.some(
					(x) =>
						x.id === e.id &&
						x.month === e.month &&
						x.fromEnvelopeId === e.from &&
						x.toEnvelopeId === e.to &&
						x.kind === e.kind &&
						toMinor(x.amount.toString(), s.loaded.book.currency) === e.minor,
				),
			));
	if (!same)
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

function assignRows(input: AssignInput, s: Snapshot): NewMovement[] {
	const left = new Map<string, Minor>();
	const rows: NewMovement[] = [];
	for (const item of input.items) {
		checkEnvelope(item.envelopeId, s);
		const e = item.envelopeId;
		const current = left.get(e) ?? s.left(e, input.month);
		let delta = item.amountMinor;
		if (input.mode === "set")
			delta = item.amountMinor - s.assigned(e, input.month);
		if (delta === 0) continue;
		const takesBack = delta < 0;
		if (takesBack && input.mode === "add" && -delta > Math.max(0, current))
			throw new EnvelopeError(
				"OVER_CAP",
				"that is more than the envelope holds",
				Math.max(0, current),
			);
		rows.push({
			id: item.id,
			month: input.month,
			from: takesBack ? e : null,
			to: takesBack ? null : e,
			minor: Math.abs(delta),
			kind: input.mode === "set" ? "SET" : takesBack ? "UNASSIGN" : "ASSIGN",
			batchId: input.batchId,
		});
		left.set(e, current + delta);
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
		null,
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
	if (input.from) {
		const cap = Math.max(0, s.left(input.from, input.month));
		if (input.amountMinor > cap)
			throw new EnvelopeError(
				"OVER_CAP",
				"that is more than the envelope holds",
				cap,
			);
	}
	return {
		id: input.id,
		month: input.month,
		from: input.from,
		to: input.to,
		minor: input.amountMinor,
		kind: input.kind,
		batchId: null,
	};
}

export async function move(
	tx: Tx,
	userId: string,
	input: MoveInput,
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const row = {
		id: input.id,
		month: input.month,
		from: input.from,
		to: input.to,
		minor: input.amountMinor,
		kind: input.kind,
		batchId: null,
	};
	const again = await replay(tx, userId, now, s, { id: input.id }, [row]);
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
	const again = await replay(
		tx,
		userId,
		now,
		s,
		{ batchId: input.id, kind: "UNDO" },
		null,
	);
	if (again) return again;
	const where =
		"movementId" in input.target
			? { id: input.target.movementId }
			: { batchId: input.target.batchId };
	const originals = await tx.budgetMovement.findMany({
		where: { ...where, bookId: s.loaded.row.id },
	});
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
	await insert(tx, s, userId, rows);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}
