const MAX_HINT_MS = 7 * 24 * 3600_000;
/** The asctime form of an HTTP date, which is GMT but names no zone. */
const ASCTIME = /^[A-Za-z]{3} [A-Za-z]{3} +\d{1,2} \d\d:\d\d:\d\d \d{4}$/;

/**
 * The wait a `Retry-After` header asks for (RFC 9110: whole seconds, or an
 * HTTP date in any of its three forms), in milliseconds, or undefined when there is none worth using.
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
	else if (/^-?[\d.]+$/.test(text)) return undefined;
	else
		ms = Date.parse(ASCTIME.test(text) ? `${text} GMT` : text) - now.getTime();
	if (!Number.isFinite(ms) || ms <= 0) return undefined;
	return Math.min(ms, MAX_HINT_MS);
}
