/**
 * What a confirm overwrote on a claim (the payer's amount, date and method),
 * kept in the confirm's audit entry so payment.unconfirm can put the claim
 * back exactly as the payer recorded it: same header, and, when the amount
 * had changed, the payer's own allocation again. Takes the open transaction
 * (mutation files may not reach the global db).
 */
import { toMinor } from "~/server/services/envelope/units";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Payment, Prisma, Settlement } from "~prisma";
import { allocatePayment } from "./allocate";
import { confirmationFor } from "./confirmation";
import { ledgerLines, payerLines } from "./ledger";
import { loadQuotes } from "./quotes";
import { writeRows } from "./write";

type Tx = Prisma.TransactionClient;

export interface ConfirmedOver {
	readonly amount: string;
	/** YYYY-MM-DD. */
	readonly paidOn: string;
	readonly paymentMethod: string | null;
}

/** The claim's details before the confirm, for its audit entry. */
export function previousOf(header: Payment): ConfirmedOver {
	return {
		amount: header.amount.toString(),
		paidOn: header.paidOn.toISOString().slice(0, 10),
		paymentMethod: header.paymentMethod,
	};
}

function isOver(v: unknown): v is ConfirmedOver {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.amount === "string" &&
		typeof o.paidOn === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(o.paidOn) &&
		(o.paymentMethod === null || typeof o.paymentMethod === "string")
	);
}

/** The latest confirm of these rows and what it overwrote, or null. */
export async function readPrevious(
	tx: Tx,
	rowIds: readonly string[],
): Promise<ConfirmedOver | null> {
	const entry = await tx.auditLogEntry.findFirst({
		where: {
			targetType: "SETTLEMENT",
			targetId: { in: [...rowIds] },
			action: "SETTLED",
		},
		orderBy: { timestamp: "desc" },
		select: { changes: true },
	});
	const previous = (entry?.changes as Record<string, unknown> | null)?.previous;
	return isOver(previous) ? previous : null;
}

/**
 * Puts a confirmed claim back to waiting with the payer's details. Same
 * amount: the rows keep their split and only the flags go back. Changed
 * amount: the receiver's rows are replaced by the payer's allocation of the
 * original amount, as payment.record wrote it from the payer's side.
 */
export async function restoreClaim(
	tx: Tx,
	header: Payment,
	rows: readonly Settlement[],
	previous: ConfirmedOver,
): Promise<{ rewritten: boolean; rows: Settlement[] }> {
	const payer: ParticipantRef = {
		participantType: header.payerType,
		participantId: header.payerId,
	};
	const payee: ParticipantRef = {
		participantType: header.payeeType,
		participantId: header.payeeId,
	};
	const paidOn = new Date(`${previous.paidOn}T00:00:00.000Z`);
	const before = toMinor(previous.amount, header.currency);
	const now = toMinor(header.amount.toString(), header.currency);
	await tx.payment.update({
		where: { id: header.id },
		data: {
			status: "PROPOSED",
			amount: previous.amount,
			paidOn,
			paymentMethod: previous.paymentMethod,
		},
	});
	if (before === now) {
		await tx.settlement.updateMany({
			where: { paymentGroupId: header.id, isOffset: false },
			data: { paymentMethod: previous.paymentMethod },
		});
		return { rewritten: false, rows: [...rows] };
	}
	// Her ledger without this payment's confirmed rows, as at record time.
	await tx.settlement.deleteMany({ where: { paymentGroupId: header.id } });
	const events = await computePairLedger(tx, payer, payee, { viewer: payer });
	const lines = payerLines(ledgerLines(events), true);
	const quotes = await loadQuotes(tx, {
		into: header.currency,
		currencies: lines.map((l) => l.currency),
		date: paidOn,
		rateType: header.rateType,
	});
	const allocation = allocatePayment({
		lines,
		currency: header.currency,
		amount: before,
		quotes,
		allowOverpay: true,
	});
	const written = await writeRows(tx, {
		id: header.id,
		parties: { payer, payee, recorder: payer },
		allocation,
		confirmation: confirmationFor(false, payee.participantType),
		paidOn,
		now: new Date(),
		paymentMethod: previous.paymentMethod,
		note: header.note,
	});
	return { rewritten: true, rows: written };
}
