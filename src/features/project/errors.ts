import { TRPCClientError } from "@trpc/client";

/** The tRPC error code of a failed call ("CONFLICT"), or null. */
export function errorCode(error: unknown): string | null {
	if (!(error instanceof TRPCClientError)) return null;
	const data = error.data as { code?: unknown } | undefined;
	return typeof data?.code === "string" ? data.code : null;
}

/**
 * Runs a save and turns any failure into one of our own sentences, so a
 * sheet never shows raw server text. `byCode` picks a sentence per tRPC
 * code; anything else gets `fallback`.
 */
export async function inOurWords<T>(
	work: () => Promise<T>,
	fallback: string,
	byCode: Record<string, string> = {},
): Promise<T> {
	try {
		return await work();
	} catch (error) {
		throw new Error(byCode[errorCode(error) ?? ""] ?? fallback);
	}
}
