/**
 * Who records and who confirms (MONEY-MOVES §1.1, rule 2). The receiver's
 * record is final; a payer's record waits for a receiver on Retrospend; a
 * receiver who can never confirm (shadow, guest) makes it final at once.
 */
import type { ParticipantType } from "~prisma";

/** Marks a settlement the payee recorded themselves ("they paid me"). */
export const RECORDED_BY_PAYEE_REASON =
	"Recorded by the payee as a payment received";

export interface Confirmation {
	readonly confirmedByPayer: boolean;
	readonly confirmedByPayee: boolean;
	readonly status: "PROPOSED" | "FINALIZED";
	readonly autoConfirmedReason: string | null;
	readonly auditAction:
		| "settlement_recorded_by_payee"
		| "settlement_auto_confirmed"
		| "settlement_initiated"
		| "settlement_confirmed";
}

/**
 * Flags of a new payer -> payee row.
 * - Recorded by the payee: FINALIZED. confirmedByPayer stays false: the
 *   payer did not act.
 * - Paid to a shadow or guest: FINALIZED (they can never confirm).
 * - Paid to a user: PROPOSED until that user confirms or says it never came.
 */
export function confirmationFor(
	recordedByPayee: boolean,
	payeeType: ParticipantType,
): Confirmation {
	if (recordedByPayee) {
		return {
			confirmedByPayer: false,
			confirmedByPayee: true,
			status: "FINALIZED",
			autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
			auditAction: "settlement_recorded_by_payee",
		};
	}
	if (payeeType !== "user") {
		return {
			confirmedByPayer: true,
			confirmedByPayee: true,
			status: "FINALIZED",
			autoConfirmedReason: `Recipient is a ${payeeType} and cannot confirm`,
			auditAction: "settlement_auto_confirmed",
		};
	}
	return {
		confirmedByPayer: true,
		confirmedByPayee: false,
		status: "PROPOSED",
		autoConfirmedReason: null,
		auditAction: "settlement_initiated",
	};
}

/**
 * The flags of a row that runs the other way (an offset of what the payee
 * owed): the recorder has agreed to every row, so their flag moves with them.
 */
export function swappedFlags(c: Confirmation) {
	return {
		confirmedByPayer: c.confirmedByPayee,
		confirmedByPayee: c.confirmedByPayer,
	};
}
