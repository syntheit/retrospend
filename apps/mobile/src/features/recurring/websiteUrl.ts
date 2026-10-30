/**
 * The website of a recurring expense, as the field is typed. People type
 * "streamly.com"; the server wants an address with its scheme, so a bare
 * host gets https. Blank is no website (`null`); something that cannot be an
 * address is `"invalid"`.
 */
export function readWebsite(text: string): string | null | "invalid" {
	const typed = text.trim();
	if (typed === "") return null;
	const url = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
	if (url.length > 512) return "invalid";
	return /^https?:\/\/[^\s/?#.]+(\.[^\s/?#.]+)+(:\d+)?([/?#]\S*)?$/i.test(url)
		? url
		: "invalid";
}
