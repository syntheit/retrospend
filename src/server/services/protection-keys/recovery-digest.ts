/**
 * The digest keys/open shows of the stored ak-recovery wrap. BLAKE2b-256 is not
 * in node:crypto (only the 512-bit output), so the server uses the one libsodium
 * build @retrospend/crypto has for Node (the sumo build, the same one the web
 * uses). It loads on the first digest, never for a caller that does not show it
 * (rotate begin), and a failed load is not kept: the next call tries again.
 */
import { recoveryWrapDigest } from "@retrospend/crypto";

/** Runs `load` once and keeps the result, but forgets a rejection so a later call retries. */
export function lazyOnce<T>(load: () => Promise<T>): () => Promise<T> {
	let loaded: Promise<T> | undefined;
	return () => {
		loaded ??= load().catch((error: unknown) => {
			loaded = undefined;
			throw error;
		});
		return loaded;
	};
}

const primitives = lazyOnce(async () =>
	(await import("@retrospend/crypto/web")).createWebPrimitives(),
);

/** The BLAKE2b-256 digest of a stored ak-recovery wrap. */
export async function digestOfRecoveryWrap(
	wrapped: Uint8Array,
): Promise<Uint8Array> {
	return recoveryWrapDigest(await primitives(), wrapped);
}
