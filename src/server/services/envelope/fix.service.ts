/**
 * Writes that follow a month close (SPEC §5.5, §5.13, D23), each one batch
 * in the current month, undone as one (D28):
 *
 * - carryOverspend (owner Q3, D40): "Take it from November's Dining
 *   instead": one CARRY_OVERSPEND from the envelope to To assign, at most
 *   what it went over in the month that just closed, less what was already
 *   carried. It may leave the envelope negative (B5).
 * - fixNegative (D23): a negative To assign back to 0 from the envelopes
 *   with the most Left (FIX_NEGATIVE), each at most what it holds.
 * - resetEnvelopes (Welcome back "Start fresh", S26): every envelope's Left
 *   goes to 0 through To assign (RESET); envelopes, targets, rules and
 *   history stay.
 *
 * Same rules as movement.service: the book's lock first, idempotent on
 * client ids, every touched envelope reported before and after (RC-5).
 */
import { randomUUID } from "node:crypto";
import type {
	CarryOverspendInput,
	MovementResult,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { EnvelopeError } from "./errors";
import { insert, replay, result } from "./movement.service";
import {
	lockedSnapshot,
	type NewMovement,
	type Snapshot,
} from "./movement-state";
import type { Minor } from "./types";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

const openEnvelopes = (s: Snapshot) =>
	s.loaded.book.envelopes.filter((e) => !e.archived);

/** A batch retry returns what it wrote; a reused id with other rows is refused. */
async function again(
	tx: Tx,
	userId: string,
	now: Date,
	s: Snapshot,
	batchId: string,
	kind: NewMovement["kind"],
) {
	return replay(tx, userId, now, s, { batchId }, (rows) =>
		rows.every((r) => r.kind === kind),
	);
}

async function write(
	tx: Tx,
	userId: string,
	now: Date,
	s: Snapshot,
	rows: NewMovement[],
): Promise<MovementResult> {
	if (rows.length === 0)
		throw new EnvelopeError("INVALID", "there is nothing to change");
	await insert(tx, s, userId, rows);
	return result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
}

/**
 * What each envelope already carried into `month` from the overspend of the
 * month before, net of undos (minor units, envelopes with none left out).
 */
export async function carriedOverspend(
	tx: Tx,
	bookId: string,
	month: number,
	currency: string,
	envelopeId?: string,
): Promise<Map<string, Minor>> {
	const rows = await tx.budgetMovement.findMany({
		where: {
			bookId,
			month,
			kind: "CARRY_OVERSPEND",
			...(envelopeId ? { fromEnvelopeId: envelopeId } : {}),
		},
		select: { id: true, amount: true, fromEnvelopeId: true },
	});
	const undone = new Set(
		(
			await tx.budgetMovement.findMany({
				where: { revertsId: { in: rows.map((r) => r.id) } },
				select: { revertsId: true },
			})
		).map((r) => r.revertsId),
	);
	const out = new Map<string, Minor>();
	for (const r of rows) {
		if (undone.has(r.id) || !r.fromEnvelopeId) continue;
		const minor = toMinor(r.amount.toString(), currency);
		out.set(r.fromEnvelopeId, (out.get(r.fromEnvelopeId) ?? 0) + minor);
	}
	for (const [id, minor] of out) if (minor === 0) out.delete(id);
	return out;
}

/** What `envelopeId` already carried from last month's overspend into this month, net of undos. */
async function carriedAlready(tx: Tx, s: Snapshot, envelopeId: string) {
	const carried = await carriedOverspend(
		tx,
		s.loaded.row.id,
		s.current,
		s.loaded.book.currency,
		envelopeId,
	);
	return carried.get(envelopeId) ?? 0;
}

export async function carryOverspend(
	tx: Tx,
	userId: string,
	input: CarryOverspendInput,
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const row: NewMovement = {
		id: input.id,
		month: s.current,
		from: input.envelopeId,
		to: null,
		minor: input.amountMinor,
		kind: "CARRY_OVERSPEND",
		batchId: null,
	};
	const retry = await replay(tx, userId, now, s, { id: input.id }, (rows) =>
		rows.every(
			(r) =>
				r.kind === "CARRY_OVERSPEND" && r.fromEnvelopeId === input.envelopeId,
		),
	);
	if (retry) return retry;
	const closed = addMonths(s.current, -1);
	if (closed < s.loaded.book.startMonth)
		throw new EnvelopeError("INVALID", "no month has closed yet");
	if (!openEnvelopes(s).some((e) => e.id === input.envelopeId))
		throw new EnvelopeError("NOT_FOUND", "no such envelope");
	const over = Math.max(0, -s.left(input.envelopeId, closed));
	const cap = over - (await carriedAlready(tx, s, input.envelopeId));
	if (input.amountMinor > cap)
		throw new EnvelopeError(
			"OVER_CAP",
			"that is more than it went over",
			Math.max(0, cap),
		);
	return write(tx, userId, now, s, [row]);
}

export async function fixNegative(
	tx: Tx,
	userId: string,
	input: { batchId: string },
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const retry = await again(tx, userId, now, s, input.batchId, "FIX_NEGATIVE");
	if (retry) return retry;
	let short: Minor = -s.toAssign;
	const rows: NewMovement[] = [];
	const sources = openEnvelopes(s)
		.map((e) => ({ id: e.id, left: s.left(e.id, s.current) }))
		.filter((e) => e.left > 0)
		.sort((a, b) => b.left - a.left || (a.id < b.id ? -1 : 1));
	for (const e of sources) {
		if (short <= 0) break;
		const take = Math.min(e.left, short);
		short -= take;
		rows.push({
			id: randomUUID(),
			month: s.current,
			from: e.id,
			to: null,
			minor: take,
			kind: "FIX_NEGATIVE",
			batchId: input.batchId,
		});
	}
	return write(tx, userId, now, s, rows);
}

export async function resetEnvelopes(
	tx: Tx,
	userId: string,
	input: { batchId: string },
	now: Date,
): Promise<MovementResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const retry = await again(tx, userId, now, s, input.batchId, "RESET");
	if (retry) return retry;
	const rows: NewMovement[] = [];
	for (const e of openEnvelopes(s)) {
		const left = s.left(e.id, s.current);
		if (left === 0) continue;
		rows.push({
			id: randomUUID(),
			month: s.current,
			from: left > 0 ? e.id : null,
			to: left > 0 ? null : e.id,
			minor: Math.abs(left),
			kind: "RESET",
			batchId: input.batchId,
		});
	}
	return write(tx, userId, now, s, rows);
}
