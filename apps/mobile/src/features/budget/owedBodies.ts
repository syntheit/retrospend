import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// Money owed to you: forgiving a balance, and routing a share that found no
// envelope. Both are previewed writes with the server's undo.

type Client = RetrospendClient["budget"];
export type ForgiveInput = Parameters<Client["forgive"]>[0];
export type ShareCategoryInput = Parameters<Client["setShareCategory"]>[0];
export type Owed = NonNullable<Awaited<ReturnType<Client["owed"]>>>;
export type OwedPerson = Owed["people"][number];
export type OwedLine = OwedPerson["lines"][number];

/** The person's key: the same one the splits use. */
export function participantKey(p: { type: string; id: string }): string {
	return `${p.type}:${p.id}`;
}

/** The lines someone owes you on (the ones above zero); you owing them is paid, not forgiven. */
export function forgivable(person: OwedPerson): OwedLine[] {
	return person.lines.filter((l) => l.amount.minor > 0);
}

/**
 * Forgive part or all of what one person owes you in one currency. The amount
 * is capped by what they owe there; `envelopeId` null charges Everything else.
 */
export function forgiveBody(input: {
	id: string;
	person: OwedPerson;
	currency: string | null;
	minor: number | null;
	envelopeId: string | null;
}): ForgiveInput | null {
	if (!input.currency || input.minor === null || input.minor <= 0) return null;
	const line = forgivable(input.person).find(
		(l) => l.amount.currency === input.currency,
	);
	if (!line || input.minor > line.amount.minor) return null;
	return {
		id: input.id,
		participant: input.person.participant,
		currency: input.currency,
		amount: wireAmount(input.minor, input.currency),
		envelopeId: input.envelopeId,
	};
}

export function shareCategoryBody(input: {
	expenseId: string;
	categoryId: string | null;
}): ShareCategoryInput | null {
	if (!input.categoryId) return null;
	return {
		transactionId: input.expenseId,
		categoryId: input.categoryId,
		source: "USER",
	};
}
