/**
 * A signed undo payload. A delete's undo puts rows back exactly as they were
 * (ids, rates, home values, template links, timestamps), so the payload holds
 * them, and the client only carries it to the toast and back. The signature
 * (a key derived from the auth secret, used for nothing else) makes sure what
 * comes back is what the server wrote, so a restore never takes amounts or
 * rates from the client.
 *
 * Every token names its kind, the user it was signed for and when it
 * expires (24 hours, like the v1 undo tokens), and a reader refuses a token
 * of another kind, for another user or past its time, with the same clean
 * BAD_REQUEST as a forged one.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { dec } from "@retrospend/domain/precise-decimal";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";

export interface RestoreToken {
	readonly data: string;
	readonly sig: string;
}

/** How long an undo token stays good. */
export const RESTORE_TTL_MS = 24 * 60 * 60 * 1000;

let key: Buffer | undefined;
function keyOf(): Buffer {
	key ??= createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update("entry-restore-token")
		.digest();
	return key;
}

const sigOf = (data: string) =>
	createHmac("sha256", keyOf()).update(data).digest("hex");

const invalid = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

/** Signs any payload as is: for formats that carry their own kind, user and expiry (api-v1/undo.ts). */
export function signPayload(payload: unknown): RestoreToken {
	const data = JSON.stringify(payload);
	return { data, sig: sigOf(data) };
}

/** A payload signPayload signed, or BAD_REQUEST when the signature is not ours. */
export function readPayload(token: RestoreToken): unknown {
	const want = Buffer.from(sigOf(token.data), "hex");
	const got = Buffer.from(token.sig, "hex");
	if (got.length !== want.length || !timingSafeEqual(got, want))
		throw invalid();
	return JSON.parse(token.data);
}

interface Envelope {
	kind: string;
	userId: string;
	exp: number;
	payload: unknown;
}

export function signRestore(
	kind: string,
	userId: string,
	payload: unknown,
	now = Date.now(),
): RestoreToken {
	const envelope: Envelope = {
		kind,
		userId,
		exp: now + RESTORE_TTL_MS,
		payload,
	};
	return signPayload(envelope);
}

/** The payload of a token of `kind` signed for `userId` that has not expired. */
export function readRestore<T>(
	token: RestoreToken,
	kind: string,
	userId: string,
	now = Date.now(),
): T {
	const got = readPayload(token) as Partial<Envelope> | null;
	if (
		typeof got !== "object" ||
		got === null ||
		got.kind !== kind ||
		got.userId !== userId ||
		typeof got.exp !== "number" ||
		got.exp < now
	)
		throw invalid();
	return got.payload as T;
}

/**
 * The signed figures an undo writes back to one row (an expense edit's
 * undo, an income delete's recreate), bound to that row: its id, amount,
 * currency, date, the home currency it was booked under, and anything else
 * the figures only fit (`bound`: an income's account and keep flag). Booking
 * again could land a cent apart, and figures in plain input would let a
 * client store any amountInUSD it likes, so the figures only travel signed.
 */
export interface RowRestore<F> {
	readonly id: string;
	readonly amount: string;
	readonly currency: string;
	/** The row's instant (ISO) or day (YYYY-MM-DD), as its undo input carries it. */
	readonly date: string;
	/** The user's home currency when it was signed. */
	readonly home: string;
	readonly bound: Readonly<Record<string, string | boolean | null>>;
	readonly figures: F;
}

type RowCheck = Omit<RowRestore<unknown>, "figures">;

const sameBound = (a: RowCheck["bound"], b: RowCheck["bound"]) => {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].every((k) => (a[k] ?? null) === (b[k] ?? null));
};

/**
 * The figures of a signed row restore, after checking it is this row's: a
 * token for another row, amount, currency, date, home currency or bound
 * field is refused like a forged one.
 */
export function readRowRestore<F>(
	token: RestoreToken,
	kind: string,
	userId: string,
	want: RowCheck,
): F {
	const got = readRestore<RowRestore<F>>(token, kind, userId);
	const same =
		got.id === want.id &&
		got.currency === want.currency &&
		got.date === want.date &&
		got.home === want.home &&
		typeof got.amount === "string" &&
		dec(got.amount).eq(dec(want.amount)) &&
		sameBound(got.bound ?? {}, want.bound);
	if (!same) throw invalid();
	return got.figures;
}
