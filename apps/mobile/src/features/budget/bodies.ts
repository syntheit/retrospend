import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// The request bodies of the budget money writes. Each preview twin takes the
// same body as its write, so the sheet builds one body and sends it to both.

type Client = RetrospendClient["budget"];
export type AssignInput = Parameters<Client["assign"]>[0];
export type MoveInput = Parameters<Client["move"]>[0];
export type CoverInput = Parameters<Client["cover"]>[0];
export type UsePlanInput = Parameters<Client["usePlan"]>[0];
export type TakeBackInput = Parameters<Client["fixNegative"]>[0];
export type LimitInput = Parameters<Client["setLimit"]>[0];

export type RestChoice = NonNullable<UsePlanInput["rest"]>;
export type LimitScope = LimitInput["scope"];

/** Assign: add to Assigned, or set Assigned to an amount (zero takes it all back). */
export function assignBody(input: {
	batchId: string;
	itemId: string;
	month: number;
	envelopeId: string;
	mode: "add" | "set";
	minor: number;
	currency: string;
}): AssignInput {
	return {
		batchId: input.batchId,
		month: input.month,
		mode: input.mode,
		items: [
			{
				id: input.itemId,
				envelopeId: input.envelopeId,
				amount: wireAmount(input.minor, input.currency),
			},
		],
	};
}

export type MoveDirection = "in" | "out";
/** The other end of a move: the pool (Not planned yet or To assign) or an envelope. */
export type Peer = { kind: "pool" } | { kind: "envelope"; id: string };

export type MoveRequest =
	| { send: "assign"; body: AssignInput }
	| { send: "move"; body: MoveInput };

/**
 * Money into an envelope from the pool is an assign; every other move is a
 * move, and one that touches the pool is an UNASSIGN (the same split as the
 * web's Move sheet).
 */
export function moveRequest(input: {
	batchId: string;
	itemId: string;
	month: number;
	envelopeId: string;
	direction: MoveDirection;
	peer: Peer;
	minor: number;
	currency: string;
}): MoveRequest {
	if (input.direction === "in" && input.peer.kind === "pool") {
		return {
			send: "assign",
			body: assignBody({ ...input, mode: "add" }),
		};
	}
	const other = input.peer.kind === "pool" ? null : input.peer.id;
	const from = input.direction === "in" ? other : input.envelopeId;
	const to = input.direction === "in" ? input.envelopeId : other;
	return {
		send: "move",
		body: {
			id: input.batchId,
			month: input.month,
			from,
			to,
			amount: wireAmount(input.minor, input.currency),
			kind: from === null || to === null ? "UNASSIGN" : "MOVE",
		},
	};
}

/** Cover an envelope from another place (null: the pool). */
export function coverBody(input: {
	id: string;
	month: number;
	envelopeId: string;
	from: string | null;
	minor: number;
	currency: string;
}): CoverInput {
	return {
		id: input.id,
		month: input.month,
		envelopeId: input.envelopeId,
		from: input.from,
		amount: wireAmount(input.minor, input.currency),
	};
}

/** Use my plan on all of the pool; the rest goes where the person chose. */
export function planBody(input: {
	batchId: string;
	rest: RestChoice;
}): UsePlanInput {
	return { batchId: input.batchId, rest: input.rest };
}

export function takeBackBody(batchId: string): TakeBackInput {
	return { batchId };
}

export function limitBody(input: {
	id: string;
	envelopeId: string;
	minor: number;
	currency: string;
	scope: LimitScope;
}): LimitInput {
	return {
		id: input.id,
		envelopeId: input.envelopeId,
		amount: wireAmount(input.minor, input.currency),
		scope: input.scope,
	};
}
