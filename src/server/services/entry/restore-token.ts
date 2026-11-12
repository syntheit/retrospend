/**
 * A signed undo payload. A delete's undo puts rows back exactly as they were
 * (ids, rates, home values, template links, timestamps), so the payload holds
 * them, and the client only carries it to the toast and back. The signature
 * (a key derived from the auth secret, used for nothing else) makes sure what
 * comes back is what the server wrote, so a restore never takes amounts or
 * rates from the client.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { dec } from "@retrospend/domain/precise-decimal";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";

export interface RestoreToken {
	readonly data: string;
	readonly sig: string;
}

let key: Buffer | undefined;
function keyOf(): Buffer {
	key ??= createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update("entry-restore-token")
		.digest();
	return key;
}

const sigOf = (data: string) =>
	createHmac("sha256", keyOf()).update(data).digest("hex");

export function signRestore(payload: unknown): RestoreToken {
	const data = JSON.stringify(payload);
	return { data, sig: sigOf(data) };
}

export function readRestore<T>(token: RestoreToken): T {
	const want = Buffer.from(sigOf(token.data), "hex");
	const got = Buffer.from(token.sig, "hex");
	if (got.length !== want.length || !timingSafeEqual(got, want)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This undo is not valid anymore",
		});
	}
	return JSON.parse(token.data) as T;
}

/**
 * The signed figures an undo writes back to one row (an expense edit's
 * undo, an income delete's recreate), bound to that row: its id, amount,
 * currency, date and the home currency it was booked under. Booking again
 * could land a cent apart, and figures in plain input would let a client
 * store any amountInUSD it likes, so the figures only travel signed.
 */
export interface RowRestore<F> {
	readonly kind: string;
	readonly id: string;
	readonly amount: string;
	readonly currency: string;
	/** The row's instant (ISO) or day (YYYY-MM-DD), as its undo input carries it. */
	readonly date: string;
	/** The user's home currency when it was signed. */
	readonly home: string;
	readonly figures: F;
}

/**
 * The figures of a signed row restore, after checking it is this row's: a
 * token for another row, kind, amount, currency or date, or one signed under
 * another home currency, is refused like a forged one.
 */
export function readRowRestore<F>(
	token: RestoreToken,
	want: Omit<RowRestore<F>, "figures">,
): F {
	const got = readRestore<RowRestore<F>>(token);
	const same =
		got.kind === want.kind &&
		got.id === want.id &&
		got.currency === want.currency &&
		got.date === want.date &&
		got.home === want.home &&
		dec(got.amount).eq(dec(want.amount));
	if (!same)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This undo is not valid anymore",
		});
	return got.figures;
}
