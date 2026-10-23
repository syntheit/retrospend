/**
 * Splits writes and reads of the envelope budget (P3, SPEC §5.8), on the
 * caller's transaction so the `*.mutation.ts` wrappers preview them:
 *
 * - setShareCategory (D19): your own category for your share of a split.
 * - setProjectRouting (D31): count your shares in a project by category,
 *   in one envelope, or not in the budget.
 * - forgive (C14): let a balance go. Written like a payment (one FINALIZED
 *   row per project scope, oldest debt first, by the payments allocator)
 *   with kind FORGIVE and no cash; the budget releases what it held and
 *   charges the envelope in the month you forgive. unforgive deletes it.
 * - owedIn: money owed with names (SPEC §6.9).
 * - saveShareDefaults: stores the smart defaults the read decided, so a
 *   share keeps its category as history grows.
 *
 * Each write touches only the caller's own rows: their participant row,
 * their project membership, settlements where they are the payee.
 */

import { randomUUID } from "node:crypto";
import type {
	ForgiveInput,
	OwedDto,
	ProjectRoutingResult,
	SetProjectRoutingInput,
	SetShareCategoryInput,
	ShareCategoryResult,
	UnforgiveInput,
} from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { lockPair } from "../payments/access";
import { allocatePayment } from "../payments/allocate";
import { ledgerLines, payerLines } from "../payments/ledger";
import { computePairLedger } from "../shared-expenses/balance";
import type { ParticipantRef } from "../shared-expenses/types";
import { userTimeZone } from "../user-time-zone";
import { EnvelopeError } from "./errors";
import { findPersonalBook, loadBook } from "./inputs";
import { forgetMonthViews, owedInputOf } from "./month-read";
import { isoDateIn } from "./months";
import { lockedSnapshot } from "./movement-state";
import { owedDto } from "./owed";
import type { UnsavedChoice } from "./splits-input";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

export async function setShareCategory(
	tx: Tx,
	userId: string,
	input: SetShareCategoryInput,
): Promise<ShareCategoryResult> {
	const share = await tx.splitParticipant.findFirst({
		where: {
			transactionId: input.transactionId,
			participantType: "user",
			participantId: userId,
		},
		select: { id: true, categoryId: true, categorySource: true },
	});
	if (!share)
		throw new EnvelopeError("NOT_FOUND", "you are not on that expense");
	if (input.categoryId) {
		const mine = await tx.category.count({
			where: { id: input.categoryId, userId, kind: "EXPENSE" },
		});
		if (mine === 0)
			throw new EnvelopeError("INVALID", "pick one of your own categories");
	}
	const source = input.categoryId ? input.source : null;
	await tx.splitParticipant.update({
		where: { id: share.id },
		data: { categoryId: input.categoryId, categorySource: source },
	});
	forgetMonthViews(tx);
	return {
		shareId: share.id,
		categoryId: input.categoryId,
		source,
		previous: { categoryId: share.categoryId, source: share.categorySource },
	};
}

export async function setProjectRouting(
	tx: Tx,
	userId: string,
	input: SetProjectRoutingInput,
): Promise<ProjectRoutingResult> {
	const member = await tx.projectParticipant.findFirst({
		where: {
			projectId: input.projectId,
			participantType: "user",
			participantId: userId,
		},
		select: { id: true, budgetRouting: true, budgetEnvelopeId: true },
	});
	if (!member)
		throw new EnvelopeError("NOT_FOUND", "you are not in that project");
	if (input.envelopeId) {
		const book = await findPersonalBook(tx, userId);
		const envelope = book?.envelopes.find((e) => e.id === input.envelopeId);
		if (!envelope || envelope.archivedAt)
			throw new EnvelopeError("NOT_FOUND", "no such envelope");
	}
	await tx.projectParticipant.update({
		where: { id: member.id },
		data: {
			budgetRouting: input.routing,
			budgetEnvelopeId: input.envelopeId,
		},
	});
	forgetMonthViews(tx);
	return {
		projectId: input.projectId,
		participantId: member.id,
		routing: input.routing,
		envelopeId: input.envelopeId,
		previous: {
			routing: member.budgetRouting,
			envelopeId: member.budgetEnvelopeId,
		},
	};
}

const refOf = (p: ForgiveInput["participant"]): ParticipantRef => ({
	participantType: p.type,
	participantId: p.id,
});

/**
 * A retry of a forgive already written: its settlement ids when the stored
 * rows match, a refusal when the id names something else, null when new.
 */
async function existingForgive(
	tx: Tx,
	userId: string,
	input: ForgiveInput,
): Promise<string[] | null> {
	const header = await tx.payment.findUnique({
		where: { id: input.id },
		include: { settlements: true },
	});
	if (!header) return null;
	const rows = header.settlements;
	const total = rows.reduce(
		(t, r) => t.add(r.amount.toString()),
		fromMinor(0, input.currency),
	);
	const same =
		header.payeeType === "user" &&
		header.payeeId === userId &&
		header.payerType === input.participant.type &&
		header.payerId === input.participant.id &&
		rows.length > 0 &&
		rows.every(
			(r) =>
				r.kind === "FORGIVE" &&
				r.currency === input.currency &&
				r.forgiveEnvelopeId === input.envelopeId,
		) &&
		total.eq(fromMinor(input.amountMinor, input.currency));
	if (!same)
		throw new EnvelopeError(
			"ID_REUSED",
			"that id was already used for another change",
		);
	return rows.map((r) => r.id);
}

/** The envelope a forgive charges must be one of yours; returns today in the book zone. */
async function checkForgiveEnvelope(
	tx: Tx,
	userId: string,
	input: ForgiveInput,
	now: Date,
) {
	if (!input.envelopeId) return null;
	const snap = await lockedSnapshot(tx, userId, now);
	const envelope = snap.loaded.book.envelopes.find(
		(e) => e.id === input.envelopeId,
	);
	if (!envelope || envelope.archived)
		throw new EnvelopeError("NOT_FOUND", "no such envelope");
	return snap.loaded.today;
}

/** Today in the book's zone, else the user's: the day the balance was let go. */
async function forgiveDay(tx: Tx, userId: string, now: Date) {
	const book = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { timeZone: true },
	});
	return isoDateIn(now, book?.timeZone ?? (await userTimeZone(userId)));
}

/** The forgive over the pair's open debts in its currency, oldest first, one row per scope. */
async function forgiveRows(
	tx: Tx,
	me: ParticipantRef,
	them: ParticipantRef,
	input: ForgiveInput,
) {
	const lines = ledgerLines(await computePairLedger(tx, me, them));
	const allocation = allocatePayment({
		lines: payerLines(lines, false),
		currency: input.currency,
		amount: input.amountMinor,
		quotes: new Map(),
		applyTo: [{ currency: input.currency }],
	});
	if (allocation.overpay > 0 || allocation.rows.length === 0)
		throw new EnvelopeError(
			"OVER_CAP",
			"that is more than they owe you",
			input.amountMinor - allocation.overpay,
		);
	return allocation.rows;
}

async function createHeader(
	tx: Tx,
	userId: string,
	them: ParticipantRef,
	input: ForgiveInput,
	today: string,
) {
	try {
		await tx.payment.create({
			data: {
				id: input.id,
				payerType: them.participantType,
				payerId: them.participantId,
				payeeType: "user",
				payeeId: userId,
				amount: "0",
				currency: input.currency,
				paidOn: new Date(`${today}T00:00:00Z`),
				recordedByType: "user",
				recordedById: userId,
				status: "FINALIZED",
			},
		});
	} catch (error) {
		// Someone else's payment holds the id: RLS hid it from the retry check.
		if ((error as { code?: string }).code === "P2002")
			throw new EnvelopeError(
				"ID_REUSED",
				"that id was already used for another change",
			);
		throw error;
	}
}

/**
 * Writes a forgive of `amountMinor` of what they owe you in `currency`
 * (C14). Returns its settlement ids; a retry with the same id returns the
 * rows it wrote.
 */
export async function forgive(
	tx: Tx,
	userId: string,
	input: ForgiveInput,
	now: Date,
): Promise<string[]> {
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	const them = refOf(input.participant);
	if (them.participantType === "user" && them.participantId === userId)
		throw new EnvelopeError("INVALID", "pick someone else");
	await lockPair(tx, me, them);
	const today =
		(await checkForgiveEnvelope(tx, userId, input, now)) ??
		(await forgiveDay(tx, userId, now));
	const again = await existingForgive(tx, userId, input);
	if (again) return again;
	const rows = (await forgiveRows(tx, me, them, input)).map((r) => ({
		...r,
		id: randomUUID(),
	}));
	await createHeader(tx, userId, them, input, today);
	await tx.settlement.createMany({
		data: rows.map((r) => ({
			id: r.id,
			fromParticipantType: them.participantType,
			fromParticipantId: them.participantId,
			toParticipantType: "user" as const,
			toParticipantId: userId,
			amount: fromMinor(r.amount, r.currency).toString(),
			currency: r.currency,
			projectId: r.scope,
			status: "FINALIZED" as const,
			confirmedByPayer: true,
			confirmedByPayee: true,
			autoConfirmedReason: "Forgiven by the payee",
			settledAt: now,
			initiatedAt: now,
			paymentGroupId: input.id,
			kind: "FORGIVE" as const,
			forgiveEnvelopeId: input.envelopeId,
		})),
	});
	forgetMonthViews(tx);
	return rows.map((r) => r.id);
}

/** What the budget released for these forgive rows: the held basis, charged to the envelope (book currency). */
export async function forgivenValue(
	tx: Tx,
	userId: string,
	settlementIds: readonly string[],
	now: Date,
): Promise<{ minor: number; currency: string } | null> {
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) return null;
	const ids = new Set(settlementIds);
	const minor = loaded.splits.replay.effects
		.filter((e) => e.term === "FORGIVEN" && ids.has(e.eventId))
		.reduce((t, e) => t + e.minor, 0);
	return { minor, currency: loaded.book.currency };
}

/** Takes a forgive back: deletes its header and rows (the undo of forgive). */
export async function unforgive(
	tx: Tx,
	userId: string,
	input: UnforgiveInput,
): Promise<{ paymentId: string }> {
	const header = await tx.payment.findUnique({
		where: { id: input.paymentId },
		include: { settlements: { select: { kind: true } } },
	});
	if (
		header?.payeeType !== "user" ||
		header.payeeId !== userId ||
		header.settlements.some((s) => s.kind !== "FORGIVE")
	)
		throw new EnvelopeError("NOT_FOUND", "nothing to take back");
	await tx.payment.delete({ where: { id: header.id } });
	forgetMonthViews(tx);
	return { paymentId: header.id };
}

/** Names of the people in an owed list, as far as you may read them. */
async function namesOf(tx: Tx, keys: readonly string[]) {
	const ids = (type: string) =>
		keys
			.filter((k) => k.startsWith(`${type}:`))
			.map((k) => k.slice(type.length + 1));
	const [users, shadows, guests] = await Promise.all([
		tx.user.findMany({
			where: { id: { in: ids("user") } },
			select: { id: true, name: true },
		}),
		tx.shadowProfile.findMany({
			where: { id: { in: ids("shadow") } },
			select: { id: true, name: true },
		}),
		tx.guestSession.findMany({
			where: { id: { in: ids("guest") } },
			select: { id: true, name: true },
		}),
	]);
	return new Map([
		...users.map((u) => [`user:${u.id}`, u.name] as const),
		...shadows.map((s) => [`shadow:${s.id}`, s.name] as const),
		...guests.map((g) => [`guest:${g.id}`, g.name] as const),
	]);
}

/** Money owed with names; null without a budget. */
export async function owedIn(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<OwedDto | null> {
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) return null;
	const input = owedInputOf(loaded);
	const keys = input.replay.balances.map((b) => b.counterparty);
	return owedDto({ ...input, names: await namesOf(tx, keys) });
}

/** Stores smart defaults once, only on shares that still have none (D19). */
export async function saveShareDefaults(
	tx: Tx,
	unsaved: readonly UnsavedChoice[],
): Promise<void> {
	const groups = new Map<string, UnsavedChoice[]>();
	for (const c of unsaved) {
		const key = `${c.categoryId}:${c.source}`;
		groups.set(key, [...(groups.get(key) ?? []), c]);
	}
	for (const list of groups.values()) {
		const first = list[0] as UnsavedChoice;
		await tx.splitParticipant.updateMany({
			where: {
				id: { in: list.map((c) => c.shareId) },
				categoryId: null,
				categorySource: null,
			},
			data: { categoryId: first.categoryId, categorySource: first.source },
		});
	}
}
