import { normalizeTimeZone } from "@retrospend/domain/time-zone";

export const TIME_ZONE_HEADER = "x-timezone";
export const TIME_ZONE_COOKIE = "tz";

/**
 * The user's IANA time zone for a request: the x-timezone header the tRPC
 * client sends, else the "tz" cookie (server components), else undefined,
 * which means the server's own zone (UTC in production).
 */
export function requestTimeZone(
	headers: Headers | null | undefined,
): string | undefined {
	if (typeof headers?.get !== "function") return undefined;
	const fromHeader = normalizeTimeZone(headers.get(TIME_ZONE_HEADER));
	if (fromHeader) return fromHeader;
	const cookie = headers.get("cookie");
	if (!cookie) return undefined;
	for (const part of cookie.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === TIME_ZONE_COOKIE) {
			try {
				return normalizeTimeZone(decodeURIComponent(rest.join("=")));
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}
