/**
 * payment.confirm (MONEY-MOVES §1.1, §1.5): the person a pending payment
 * waits for confirms it, and every row of the group turns final together.
 * The receiver's details win: they may correct the method and the date,
 * and, from "Same payment?", the amount ("Confirm ARS 18,000 instead"), in
 * which case the payment is allocated again from the receiver's side.
 */
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "~/lib/money";
import type { Money } from "~/server/figures/registry";
import { fromMinor, toMinor } from "~/server/services/envelope/units";
import type { MoneyMutation, UndoToken } from "~/server/services/preview/types";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import {
	groupCounterparty,
	groupRoles,
} from "~/server/services/shared-expenses/settlement-groups";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma } from "~prisma";
import { lockSettledSplits } from "../corrections/locks";
import { lockPair } from "./access";
import { type Allocation, allocatePayment } from "./allocate";
import {
	ledgerFingerprint,
	previousOf,
	readPrevious,
	restoreClaim,
} from "./confirm-restore";
import type { Confirmation } from "./confirmation";
import { ledgerLines, payerLines } from "./ledger";
import { loadQuotes } from "./quotes";
import { type AllocationView, personKey, viewAllocation } from "./view";
import { logGroupAction, updateGroup, writeRows } from "./write";

type Tx = Prisma.TransactionClient;

/**
 * Confirming a claim would credit more than the receiver is still owed on
 * those debts (they already recorded the money themselves): the claim is
 * refused, and `instead` is what is still owed, to confirm in its place
 * (null when nothing is). Keeps I3 and the "no double credit" rule.
 */
export class ConfirmInsteadError extends TRPCError {
	constructor(readonly instead: Money | null) {
		super({
			code: "CONFLICT",
			message: instead
				? `That is more than is still owed. Confirm ${instead.currency} ${fromMinor(instead.minor, instead.currency).toFixed(currencyDecimals(instead.currency))} instead.`
				: "Nothing is owed on this payment anymore. Say it was not received instead.",
		});
		this.name = "ConfirmInsteadError";
	}
}

export interface ConfirmPaymentInput {
	/** The payment id, or the id of any of its settlement rows. */
	readonly paymentId: string;
	readonly paymentMethod?: string | null;
	/** YYYY-MM-DD; keeps the payer's date when omitted. */
	readonly paidOn?: string | null;
	/** Decimal string in the payment currency; keeps the payer's amount when omitted. */
	readonly amount?: string | null;
}

export interface ConfirmedClaim {
	readonly paymentId: string;
	readonly counterparty: ParticipantRef;
	/** Set when the amount changed and the rows were allocated again. */
	readonly allocation: Allocation | null;
	readonly undo: UndoToken;
}

const FINAL: Confirmation = {
	confirmedByPayer: true,
	confirmedByPayee: true,
	status: "FINALIZED",
	autoConfirmedReason: null,
	auditAction: "settlement_confirmed",
};

async function loadPayment(tx: Tx, id: string) {
	let header = await tx.payment.findUnique({ where: { id } });
	if (!header) {
		const row = await tx.settlement.findUnique({
			where: { id },
			select: { paymentGroupId: true },
		});
		header = row?.paymentGroupId
			? await tx.payment.findUnique({ where: { id: row.paymentGroupId } })
			: null;
	}
	if (!header) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
	}
	const rows = await tx.settlement.findMany({
		where: { paymentGroupId: header.id },
		orderBy: { initiatedAt: "asc" },
	});
	return { header, rows };
}

function assertAwaitingMe(roles: ReturnType<typeof groupRoles>) {
	if (roles.status === "FINALIZED") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Settlement is already confirmed",
		});
	}
	if (roles.status === "REJECTED") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Settlement is already rejected",
		});
	}
	if (!roles.isParty || !roles.awaitingMe) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the payee can confirm this settlement",
		});
	}
}

/**
 * Allocates `amount` from `me`'s side, where a claim waiting for me does not
 * count yet: what it would pay of what I am still owed. More than that is
 * refused with what is still owed as the amount to confirm instead.
 */
async function allocateForMe(
	tx: Tx,
	me: ParticipantRef,
	header: Awaited<ReturnType<typeof loadPayment>>["header"],
	amount: number,
	paidOn: Date,
	counterparty: ParticipantRef,
): Promise<Allocation> {
	const payerIsMe =
		header.payerType === me.participantType &&
		header.payerId === me.participantId;
	const events = await computePairLedger(tx, me, counterparty, { viewer: me });
	const lines = payerLines(ledgerLines(events), payerIsMe);
	const quotes = await loadQuotes(tx, {
		into: header.currency,
		currencies: lines.map((l) => l.currency),
		date: paidOn,
		rateType: header.rateType,
	});
	const allocation = allocatePayment({
		lines,
		currency: header.currency,
		amount,
		quotes,
	});
	if (allocation.overpay > 0) {
		throw new ConfirmInsteadError(
			allocation.full > 0
				? { minor: allocation.full, currency: header.currency }
				: null,
		);
	}
	return allocation;
}

/** Confirms a pending payment for `me`; also the "Same payment" path of payment.record. */
export async function confirmClaim(
	tx: Tx,
	me: ParticipantRef,
	input: ConfirmPaymentInput,
): Promise<ConfirmedClaim> {
	const { header, rows } = await loadPayment(tx, input.paymentId);
	assertAwaitingMe(groupRoles(rows, me.participantId));
	const other = groupCounterparty(rows, me.participantId);
	if (!other)
		throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
	const counterparty = other as ParticipantRef;
	await lockPair(tx, me, counterparty);

	const now = new Date();
	const paidOn = input.paidOn
		? new Date(`${input.paidOn}T00:00:00.000Z`)
		: header.paidOn;
	const paymentMethod = input.paymentMethod ?? header.paymentMethod;
	const amount =
		input.amount == null ? null : toMinor(input.amount, header.currency);
	const changed =
		amount !== null &&
		amount !== toMinor(header.amount.toString(), header.currency);

	let allocation: Allocation | null = null;
	let written = rows;
	// Checked before anything is written: the claim, or the amount the
	// receiver typed, must fit what is still owed (H1, I3).
	const fits = await allocateForMe(
		tx,
		me,
		header,
		amount ?? toMinor(header.amount.toString(), header.currency),
		paidOn,
		counterparty,
	);
	if (changed) {
		await tx.settlement.deleteMany({ where: { paymentGroupId: header.id } });
		allocation = fits;
		const payer = {
			participantType: header.payerType,
			participantId: header.payerId,
		};
		const payee = {
			participantType: header.payeeType,
			participantId: header.payeeId,
		};
		written = await writeRows(tx, {
			id: header.id,
			parties: {
				payer,
				payee,
				recorder: {
					participantType: header.recordedByType,
					participantId: header.recordedById,
				},
			},
			allocation,
			confirmation: FINAL,
			paidOn,
			now,
			paymentMethod,
			note: header.note,
		});
	} else {
		await updateGroup(tx, rows, ["PROPOSED"], {
			confirmedByPayer: true,
			confirmedByPayee: true,
			status: "FINALIZED",
			settledAt: now,
		});
		if (input.paymentMethod) {
			await tx.settlement.updateMany({
				where: { paymentGroupId: header.id, isOffset: false },
				data: { paymentMethod },
			});
		}
	}
	await tx.payment.update({
		where: { id: header.id },
		data: {
			status: "FINALIZED",
			paidOn,
			paymentMethod,
			...(allocation ? { amount: input.amount ?? undefined } : {}),
		},
	});
	await lockSettledSplits(tx, me, header.id);
	// The rows as they now stand: after an amount change, the ones just written.
	// The entry keeps the claim as it was, for an exact undo.
	await logGroupAction(tx, me, written, {
		action: "SETTLED",
		context: "settlement_confirmed",
		changes: {
			previous: previousOf(
				header,
				rows,
				await ledgerFingerprint(tx, me, counterparty),
			),
			...(changed ? { confirmedAmount: input.amount } : {}),
		},
	});
	return {
		paymentId: header.id,
		counterparty,
		allocation,
		// Undo puts the payment back to waiting (payment.unconfirm), never deletes it.
		undo: {
			kind: "revert",
			mutation: "payment.unconfirm",
			rows: [{ table: "payment", id: header.id }],
		},
	};
}

/** The other person on a payment, from `userId`'s side, for the preview's narrowing. */
export async function paymentCounterparty(
	db: Tx,
	paymentId: string,
	userId: string,
): Promise<ParticipantRef> {
	const { rows } = await loadPayment(db, paymentId);
	const other = groupCounterparty(rows, userId);
	if (!other)
		throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });
	return other as ParticipantRef;
}

export interface ConfirmPaymentValue {
	readonly paymentId: string;
	readonly counterparty: ParticipantRef;
	readonly allocation: AllocationView | null;
}

/**
 * The mutation reads the payment to know which person's figures to narrow
 * to, so the transport passes the counterparty it already resolved.
 */
/** A confirmed payment to you returns held money to To assign (D8): the budget figures move. */
const CONFIRM_FIGURES = [
	"balance.person",
	"owed.owedToYou",
	"owed.youOwe",
	"budget.notPlannedYet",
	"budget.heldForOthers",
];

export const confirmPayment: MoneyMutation<
	ConfirmPaymentInput & { readonly person: ParticipantRef },
	ConfirmPaymentValue
> = {
	id: "payment.confirm",
	touches: CONFIRM_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me: ParticipantRef = {
			participantType: "user",
			participantId: actor.userId,
		};
		const confirmed = await confirmClaim(tx, me, input);
		if (personKey(confirmed.counterparty) !== personKey(input.person)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "This payment is with someone else",
			});
		}
		return {
			value: {
				paymentId: confirmed.paymentId,
				counterparty: confirmed.counterparty,
				allocation:
					confirmed.allocation && viewAllocation(confirmed.allocation),
			},
			undo: confirmed.undo,
		};
	},
};

/**
 * payment.unconfirm, the undo of payment.confirm: the payment waits for the
 * same person again, every row with only the recorder's flag set, and the
 * receiver's view goes back to showing it as a claim. Details the receiver
 * changed while confirming (method, date, amount) go back to the payer's,
 * read from the confirm's audit entry (confirm-restore.ts).
 */
export const unconfirmPayment: MoneyMutation<
	{ readonly paymentId: string; readonly person: ParticipantRef },
	{ readonly paymentId: string }
> = {
	id: "payment.unconfirm",
	touches: CONFIRM_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me: ParticipantRef = {
			participantType: "user",
			participantId: actor.userId,
		};
		// Locked before the read, so the rows checked are the rows restored.
		await lockPair(tx, me, input.person);
		const { header, rows } = await loadPayment(tx, input.paymentId);
		const recorder: ParticipantRef = {
			participantType: header.recordedByType,
			participantId: header.recordedById,
		};
		const payer: ParticipantRef = {
			participantType: header.payerType,
			participantId: header.payerId,
		};
		const payee: ParticipantRef = {
			participantType: header.payeeType,
			participantId: header.payeeId,
		};
		// Only a real confirm can be undone: the payer recorded it, the payee
		// (the caller) confirmed it, and no row was final at once.
		const confirmedByMe =
			header.status === "FINALIZED" &&
			personKey(payee) === personKey(me) &&
			personKey(recorder) === personKey(payer) &&
			rows.every((r) => r.autoConfirmedReason === null);
		if (!confirmedByMe) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Only the person who confirmed this payment can undo it",
			});
		}
		// The claim goes back verbatim: header and rows as the payer left them.
		const previous = await readPrevious(
			tx,
			rows.map((r) => r.id),
		);
		const restored = previous
			? await restoreClaim(tx, header, rows, previous, {
					me,
					other: input.person,
				})
			: null;
		if (!restored) {
			for (const row of rows) {
				const fromRecorder =
					row.fromParticipantType === recorder.participantType &&
					row.fromParticipantId === recorder.participantId;
				await tx.settlement.update({
					where: { id: row.id },
					data: {
						status: "PROPOSED",
						settledAt: null,
						confirmedByPayer: fromRecorder,
						confirmedByPayee: !fromRecorder,
					},
				});
			}
			await tx.payment.update({
				where: { id: header.id },
				data: { status: "PROPOSED" },
			});
		}
		await logGroupAction(tx, me, restored ?? rows, {
			action: "EDITED",
			context: "settlement_unconfirmed",
		});
		return {
			value: { paymentId: header.id },
			undo: {
				kind: "revert",
				mutation: "payment.confirm",
				rows: [{ table: "payment", id: header.id }],
			},
		};
	},
};
