/**
 * A signed undo payload. A delete's undo puts rows back exactly as they were
 * (ids, rates, home values, template links, timestamps), so the payload holds
 * them, and the client only carries it to the toast and back. The signature
 * (a key derived from the auth secret, used for nothing else) makes sure what
 * comes back is what the server wrote, so a restore never takes amounts or
 * rates from the client.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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
