import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// Closing a month, coming back after time away, and starting money: the
// writes that settle where the budget stands.

type Client = RetrospendClient["budget"];
export type CarryInput = Parameters<Client["carryOverspend"]>[0];
export type WelcomeBackInput = Parameters<Client["welcomeBack"]>[0];
export type StartingMoneyInput = Parameters<Client["confirmStartingMoney"]>[0];
export type AcknowledgeInput = Parameters<Client["acknowledgeMonth"]>[0];
export type MonthSummary = NonNullable<
	Awaited<ReturnType<Client["monthSummary"]>>
>;
export type WelcomeBackState = Awaited<ReturnType<Client["welcomeBackState"]>>;

/** Take last month's overspend from the envelope that went over, this month. */
export function carryBody(input: {
	id: string;
	envelopeId: string;
	minor: number;
	currency: string;
}): CarryInput | null {
	if (input.minor <= 0) return null;
	return {
		id: input.id,
		envelopeId: input.envelopeId,
		amount: wireAmount(input.minor, input.currency),
	};
}

export type WelcomeChoice = WelcomeBackInput["choice"];

/** One of the three ways back; null while "set what I have" has no amount. */
export function welcomeBackBody(input: {
	choice: WelcomeChoice;
	id: string;
	batchId: string;
	minor: number | null;
	currency: string;
}): WelcomeBackInput | null {
	if (input.choice === "CATCH_UP") return { choice: "CATCH_UP" };
	if (input.choice === "START_FRESH") {
		return { choice: "START_FRESH", batchId: input.batchId };
	}
	if (input.minor === null) return null;
	return {
		choice: "SET_HAVE_NOW",
		id: input.id,
		amount: wireAmount(input.minor, input.currency),
	};
}

/** How much you have right now; zero is an answer. */
export function startingMoneyBody(input: {
	id: string;
	minor: number | null;
	currency: string;
}): StartingMoneyInput | null {
	if (input.minor === null) return null;
	return { id: input.id, amount: wireAmount(input.minor, input.currency) };
}

/** Marks the revision of a closed month the person has read; null when it was read already. */
export function acknowledgeBody(
	month: number,
	summary: MonthSummary,
): AcknowledgeInput | null {
	return summary.acknowledgedRevision === summary.revision
		? null
		: { month, revision: summary.revision };
}
