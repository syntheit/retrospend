/**
 * What a movement write reads before it writes (movement.service.ts): the
 * book's state under its advisory lock, the month and envelope checks, and
 * the running caps a batch is checked against row by row.
 */
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { computeBook } from "./engine";
import { EnvelopeError } from "./errors";
import { findPersonalBook, type LoadedBook, loadBook } from "./inputs";
import { takeBackCap } from "./planning";
import type { Minor, MonthKey } from "./types";

type Tx = Prisma.TransactionClient;
export type Kind = "ASSIGN" | "SET" | "MOVE" | "COVER" | "UNASSIGN" | "UNDO";

export interface NewMovement {
	id: string;
	month: MonthKey;
	from: string | null;
	to: string | null;
	minor: Minor;
	kind: Kind;
	batchId: string | null;
	revertsId?: string;
}

export interface Snapshot {
	loaded: LoadedBook;
	left: (envelopeId: string, month: MonthKey) => Minor;
	assigned: (envelopeId: string, month: MonthKey) => Minor;
	/** Net movements out of To assign in a month. */
	poolAssigned: (month: MonthKey) => Minor;
	toAssign: Minor;
	current: MonthKey;
}

/** One writer per book at a time (02 §2; month close takes the same lock in P4). */
async function lockBook(tx: Tx, bookId: string) {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget_book:${bookId}`}))`;
}

export async function snapshot(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<Snapshot> {
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
		poolAssigned: (month) => state.month(month).totals.assigned,
		toAssign: state.toAssign(c).total,
		current: c,
	};
}

/**
 * Running Left and Assigned while a write builds its rows, so every row of a
 * batch is capped against the rows before it.
 */
export class Tracker {
	private readonly delta = new Map<string, { left: Minor; assigned: Minor }>();
	private readonly pool = new Map<MonthKey, Minor>();

	constructor(private readonly s: Snapshot) {}

	private key = (id: string, month: MonthKey) => `${id}:${month}`;

	left(id: string, month: MonthKey) {
		return (
			this.s.left(id, month) + (this.delta.get(this.key(id, month))?.left ?? 0)
		);
	}

	assigned(id: string, month: MonthKey) {
		return (
			this.s.assigned(id, month) +
			(this.delta.get(this.key(id, month))?.assigned ?? 0)
		);
	}

	/** Most that can go from `id` back to To assign (planning.takeBackCap). */
	takeBackCap(id: string, month: MonthKey) {
		return takeBackCap({
			month,
			currentMonth: this.s.current,
			left: this.left(id, month),
			assigned: this.assigned(id, month),
			poolAssigned: this.s.poolAssigned(month) + (this.pool.get(month) ?? 0),
		});
	}

	apply(r: Pick<NewMovement, "from" | "to" | "month" | "minor">) {
		const bump = (id: string, v: Minor) => {
			const d = this.delta.get(this.key(id, r.month)) ?? {
				left: 0,
				assigned: 0,
			};
			this.delta.set(this.key(id, r.month), {
				left: d.left + v,
				assigned: d.assigned + v,
			});
		};
		if (r.from) bump(r.from, -r.minor);
		else this.pool.set(r.month, (this.pool.get(r.month) ?? 0) + r.minor);
		if (r.to) bump(r.to, r.minor);
		else this.pool.set(r.month, (this.pool.get(r.month) ?? 0) - r.minor);
	}

	/** Refuses a row that takes more than the cap out of its source. */
	check(r: Pick<NewMovement, "from" | "to" | "month" | "minor">) {
		if (!r.from) return;
		const cap =
			r.to === null
				? this.takeBackCap(r.from, r.month)
				: Math.max(0, this.left(r.from, r.month));
		if (r.minor > cap)
			throw new EnvelopeError(
				"OVER_CAP",
				"that is more than the envelope holds",
				cap,
			);
	}
}

/** Locks the user's book and reads it after the lock, so caps see every committed write. */
export async function lockedSnapshot(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<Snapshot> {
	const book = await findPersonalBook(tx, userId);
	if (!book) throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	return snapshot(tx, userId, now);
}

export function checkMonth(month: MonthKey, s: Snapshot) {
	if (month < s.current)
		throw new EnvelopeError("MONTH_CLOSED", "that month has closed");
	if (month > addMonths(s.current, 1))
		throw new EnvelopeError(
			"INVALID",
			"money can be planned for this month and the next only",
		);
}

export function checkEnvelope(id: string, s: Snapshot) {
	const e = s.loaded.book.envelopes.find((x) => x.id === id);
	if (!e) throw new EnvelopeError("NOT_FOUND", "no such envelope");
	if (e.archived)
		throw new EnvelopeError("INVALID", "that envelope is archived");
}
