/**
 * The security.txt (RFC 9116) people and scanners fetch to learn where to
 * report a vulnerability. The contact is the operator's: SECURITY_CONTACT, or
 * the project's private report form, so a self-hosted instance never points
 * at an inbox nobody reads.
 */

export const DEFAULT_SECURITY_CONTACT =
	"https://github.com/syntheit/retrospend/security/advisories/new";

export const SECURITY_POLICY_URL =
	"https://github.com/syntheit/retrospend/blob/main/SECURITY.md";

// The RFC asks for an expiry under a year out; a rolling date keeps a
// self-hosted file from going stale and being ignored.
const VALID_DAYS = 364;

// Whitespace and control characters end a field value, so none may appear in
// one: a line break in a setting would otherwise add fields of its own.
function unsafe(value: string): boolean {
	for (const ch of value) {
		const code = ch.charCodeAt(0);
		if (code <= 0x20 || code === 0x7f || /\s/.test(ch)) return true;
	}
	return false;
}
const MAILTO = /^mailto:[^\s@,:/?#]+@[^\s@,:/?#]+$/i;

/**
 * One contact as a URI: a mailto: address, an https: link, or a bare address
 * (which gets mailto:). Anything else is dropped.
 */
function toContactUri(raw: string): string | null {
	const value = raw.trim();
	if (!value || unsafe(value)) return null;
	if (/^mailto:/i.test(value)) return MAILTO.test(value) ? value : null;
	if (/^https:\/\//i.test(value)) {
		try {
			return new URL(value).host ? value : null;
		} catch {
			return null;
		}
	}
	return MAILTO.test(`mailto:${value}`) ? `mailto:${value}` : null;
}

/** The origin of the public URL, or null when it is not a clean http(s) URL. */
function originOf(raw: string): string | null {
	const value = raw.trim();
	if (!value || unsafe(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.origin
			: null;
	} catch {
		return null;
	}
}

/**
 * `contact` is a comma-separated list, so a comma cannot be part of a link:
 * each piece is checked on its own and a piece that is not a valid contact is
 * dropped.
 */
export function securityTxt(opts: {
	contact?: string;
	publicUrl?: string;
	now?: Date;
}): string {
	const contacts = (opts.contact ?? "")
		.split(",")
		.map(toContactUri)
		.filter((c): c is string => c !== null);
	const now = opts.now ?? new Date();
	const expires = new Date(now.getTime() + VALID_DAYS * 86_400_000);

	const lines = (contacts.length ? contacts : [DEFAULT_SECURITY_CONTACT]).map(
		(c) => `Contact: ${c}`,
	);
	lines.push(`Expires: ${expires.toISOString()}`);
	lines.push("Preferred-Languages: en");
	const origin = originOf(opts.publicUrl ?? "");
	if (origin) lines.push(`Canonical: ${origin}/.well-known/security.txt`);
	lines.push(`Policy: ${SECURITY_POLICY_URL}`);
	return `${lines.join("\n")}\n`;
}
