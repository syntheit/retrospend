import { isIP } from "node:net";

/**
 * Registration-time check of a UnifiedPush endpoint's host. The server
 * will later POST to this URL, so an address that names the server's own
 * network (an IP literal, localhost) is refused unless the operator lists
 * it in PUSH_ENDPOINT_ALLOW_HOSTS (a LAN ntfy server). This only stops the
 * obvious cases: a public name can still resolve to a private address, so
 * the sender must resolve, pin and check the IP itself (docs/ui/GAPS.md).
 */

/** Lowercase, without brackets or a trailing dot, so forms compare equal. */
function normalizeHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")
		.replace(/\.$/, "");
}

/** PUSH_ENDPOINT_ALLOW_HOSTS: comma-separated host names or IP literals. */
export function parseAllowHosts(raw: string | undefined): ReadonlySet<string> {
	return new Set(
		(raw ?? "")
			.split(",")
			.map(normalizeHost)
			.filter((h) => h.length > 0),
	);
}

export function isAllowedPushEndpoint(
	endpoint: string,
	allowHosts: ReadonlySet<string>,
): boolean {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	// The URL parser has already turned decimal, hex and short IPv4 forms
	// into dotted quads, so isIP sees every IP literal.
	const host = normalizeHost(url.hostname);
	if (allowHosts.has(host)) return true;
	if (isIP(host) !== 0) return false;
	return host !== "localhost" && !host.endsWith(".localhost");
}
