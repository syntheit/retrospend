import { TRPCError } from "@trpc/server";
import {
	readRestore,
	signRestore,
} from "~/server/services/entry/restore-token";

/**
 * Undo tokens of the ledger groups (expenses, income, transfers, recurring).
 * A token is the signed input of the inverse mutation: the web's restore
 * payloads, bound to one user, one group and 24 hours. The signature (a key
 * derived from the auth secret, entry/restore-token.ts) means a client can
 * carry a token but never write its own amounts or rates into it.
 */
export const UNDO_TTL_MS = 24 * 60 * 60 * 1000;

export type UndoFamily = "expense" | "income" | "transfer" | "recurring";

type Payload = {
	v: 1;
	userId: string;
	family: UndoFamily;
	op: string;
	input: unknown;
	exp: number;
};

const invalid = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

export function mintUndo(
	userId: string,
	family: UndoFamily,
	op: string,
	input: unknown,
	now = Date.now(),
): string {
	const payload: Payload = {
		v: 1,
		userId,
		family,
		op,
		input,
		exp: now + UNDO_TTL_MS,
	};
	const { data, sig } = signRestore(payload);
	return `${Buffer.from(data, "utf8").toString("base64url")}.${sig}`;
}

export function readUndo(
	userId: string,
	family: UndoFamily,
	token: string,
	now = Date.now(),
): { op: string; input: unknown } {
	const [encoded, sig, extra] = token.split(".");
	if (!encoded || !sig || extra !== undefined || !/^[0-9a-f]{64}$/.test(sig))
		throw invalid();
	const payload = readRestore<Payload>({
		data: Buffer.from(encoded, "base64url").toString("utf8"),
		sig,
	});
	if (
		payload.v !== 1 ||
		payload.userId !== userId ||
		payload.family !== family ||
		payload.exp < now
	)
		throw invalid();
	return { op: payload.op, input: payload.input };
}
