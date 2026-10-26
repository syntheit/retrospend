const MAX_HINT_MS = 7 * 24 * 3600_000;

/**
 * The wait a `Retry-After` header asks for (RFC 9110: whole seconds, or an
 * HTTP date), in milliseconds, or undefined when there is none worth using.
 * The scheduler caps it again; this only keeps the number sane.
 */
export function parseRetryAfter(
	value: string | null | undefined,
	now: Date,
): number | undefined {
	const text = value?.trim();
	if (!text) return undefined;
	let ms: number;
	if (/^\d+$/.test(text)) ms = Number(text) * 1000;
	else if (/^[A-Za-z]{3},/.test(text)) ms = Date.parse(text) - now.getTime();
	else return undefined;
	if (!Number.isFinite(ms) || ms <= 0) return undefined;
	return Math.min(ms, MAX_HINT_MS);
}
