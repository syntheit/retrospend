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

/** Turns "a@b.c" into "mailto:a@b.c"; keeps mailto: and https: links. */
function toContactUri(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	if (/^(mailto:|https:\/\/)/i.test(value)) return value;
	if (/^[^\s@:/]+@[^\s@:/]+$/.test(value)) return `mailto:${value}`;
	return null;
}

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
	if (opts.publicUrl) {
		const origin = opts.publicUrl.replace(/\/+$/, "");
		lines.push(`Canonical: ${origin}/.well-known/security.txt`);
	}
	lines.push(`Policy: ${SECURITY_POLICY_URL}`);
	return `${lines.join("\n")}\n`;
}
