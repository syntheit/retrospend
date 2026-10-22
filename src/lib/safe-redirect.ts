/**
 * A post-login destination that can only stay on this site: a path starting
 * with one "/", never "//" or "/\" (browsers read both as another host), no
 * backslashes or control characters anywhere. Anything else is the
 * dashboard.
 */
export function safeRedirect(raw: string | null | undefined): string {
	if (!raw?.startsWith("/")) return "/dashboard";
	if (raw.startsWith("//") || raw.includes("\\")) return "/dashboard";
	for (const ch of raw) {
		const code = ch.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return "/dashboard";
	}
	return raw;
}
