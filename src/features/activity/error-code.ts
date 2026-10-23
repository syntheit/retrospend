/**
 * What a failed save says, by the server's error code only: a toast never
 * shows the server's own message text, which is English and technical
 * (GUIDELINE §13). Each page maps these to its own i18n strings.
 */
export type SaveError = "conflict" | "gone" | "forbidden" | "other";

export function saveError(error: unknown): SaveError {
	const data =
		error && typeof error === "object" && "data" in error
			? (error as { data?: { code?: unknown } | null }).data
			: undefined;
	switch (data?.code) {
		case "CONFLICT":
			return "conflict";
		case "NOT_FOUND":
			return "gone";
		case "FORBIDDEN":
		case "UNAUTHORIZED":
			return "forbidden";
		default:
			return "other";
	}
}
