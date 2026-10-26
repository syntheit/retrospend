/**
 * What the person exports share: the expenses two people are both on, and
 * the balance between them. A share the signed-in person cannot see (the
 * other person's, when they owe and the other paid) reads empty in a file,
 * never 0. The balance is the People page's own (the pair
 * ledger in minor units, claim aliases merged, a payment someone has not yet
 * confirmed counted only for the person who recorded it), so the file and
 * the screen cannot disagree.
 */
import { TRPCError } from "@trpc/server";
import {
	ledgerLines,
	overallByCurrency,
} from "~/server/services/payments/ledger";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import type { ParticipantType, PrismaClient } from "~prisma";
import { minorText } from "./amounts";

export interface PersonRef {
	participantType: ParticipantType;
	participantId: string;
}

/**
 * Expenses where both the user and `them` have a split row, as a where
 * clause. The database answers with the ids: outside a project a debtor
 * sees only their own split row, so a filter on the other person's row
 * would find nothing for exactly the person who owes (migration
 * s3_followups, shared_expense_ids_with). Runs as the signed-in user.
 */
export async function sharedWith(db: PrismaClient, them: PersonRef) {
	const rows = await db.$transaction(
		(tx) =>
			tx.$queryRaw<
				{ transactionId: string }[]
			>`SELECT "transactionId" FROM shared_expense_ids_with(${them.participantType}, ${them.participantId})`,
	);
	return { id: { in: rows.map((r) => r.transactionId) } };
}

export function noSharedExpenses(): TRPCError {
	return new TRPCError({
		code: "NOT_FOUND",
		message: "No shared transactions found with this person",
	});
}

export interface PersonBalance {
	currency: string;
	/** What is owed, always zero or more. */
	minor: number;
	direction: "they_owe_you" | "you_owe_them" | "settled";
}

/**
 * The balance with `them` per currency, from the user's side. Only open
 * balances are listed, sorted by currency; a person with one currency and
 * nothing open gets that currency as "settled".
 */
export async function pairBalances(
	db: PrismaClient,
	userId: string,
	them: PersonRef,
	currenciesSeen: readonly string[],
): Promise<PersonBalance[]> {
	const me: PersonRef = { participantType: "user", participantId: userId };
	const events = await computePairLedger(db, me, them, { viewer: me });
	const open = [...overallByCurrency(ledgerLines(events))].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	if (open.length === 0) {
		const only = [...new Set(currenciesSeen)];
		return only.length === 1
			? [{ currency: only[0] as string, minor: 0, direction: "settled" }]
			: [];
	}
	return open.map(([currency, minor]) => ({
		currency,
		minor: Math.abs(minor),
		direction: minor > 0 ? "they_owe_you" : "you_owe_them",
	}));
}

/** "Ben owes you" / "You owe Ben" / "Settled". */
export function directionText(
	direction: PersonBalance["direction"],
	theirName: string,
): string {
	if (direction === "settled") return "Settled";
	return direction === "they_owe_you"
		? `${theirName} owes you`
		: `You owe ${theirName}`;
}

export const balanceText = (b: PersonBalance) => minorText(b.minor, b.currency);
