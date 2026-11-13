import { FieldCryptoError } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { db } from "~/server/db";

/**
 * The host bucket of a delivery whose url could not be read. Settling one
 * costs no network time, so the shared per-host cap is only a bound.
 */
export const UNREADABLE_HOST = "unreadable";

/** What `pickDue` read from the url: the address and its cap host, or the failure. */
export type OpenedUrl =
	| { url: string; host: string | null; urlError?: false }
	| { url: null; host: typeof UNREADABLE_HOST; urlError: true };

const cannotOpen = (error: unknown): boolean =>
	error instanceof FieldCryptoError || textUnavailableProblem(error) !== null;

/**
 * The url of each webhook, opened on the global client, or null for one that
 * cannot be opened (a damaged cell, a key that is not available). A batch
 * that fails for such a cell is read again one webhook at a time, so only the
 * deliveries of that webhook fail; any other error is not about a url and
 * ends the pull.
 */
export async function openUrls(
	ids: string[],
): Promise<Map<string, string | null>> {
	try {
		const rows = await db.webhook.findMany({
			where: { id: { in: ids } },
			select: { id: true, url: true },
		});
		return new Map(rows.map((r) => [r.id, r.url]));
	} catch (error) {
		if (!cannotOpen(error)) throw error;
	}
	const urls = new Map<string, string | null>();
	for (const id of ids) {
		try {
			const row = await db.webhook.findUnique({
				where: { id },
				select: { url: true },
			});
			if (row) urls.set(id, row.url);
		} catch (error) {
			if (!cannotOpen(error)) throw error;
			urls.set(id, null);
		}
	}
	return urls;
}
