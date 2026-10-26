/**
 * What the person exports share: the expenses two people are both on, and
 * the balance between them. The balance is the People page's own (the pair
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

/** Expenses where both the user and `them` have a split row. */
export function sharedWith(userId: string, them: PersonRef) {
	return {
		AND: [
			{
				splitParticipants: {
					some: { participantType: "user" as const, participantId: userId },
				},
			},
			{
				splitParticipants: {
					some: {
						participantType: them.participantType,
						participantId: them.participantId,
					},
				},
			},
		],
	};
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
