// What a system surface hands the composer: a shared text or file, a
// Shortcuts "Add expense" with an amount, or a retrospend://add link. Pure
// parsing only; the native side (modules/surfaces) just carries JSON.

export type PrefillMode = "expense" | "income";

/** A file shared in (a receipt photo or PDF). The composer has no attachment slot yet. */
export interface SharedFile {
	/** A file:// path (iOS App Group) or a content:// URI (Android). */
	uri: string;
	mime: string;
	name: string;
}

export interface ComposerPrefill {
	mode: PrefillMode;
	/** Canonical amount, digits with "." as the decimal point ("1234.50"). */
	amount?: string;
	/** ISO code; the composer ignores one it has no rate for. */
	currency?: string;
	title?: string;
	file?: SharedFile;
}

const TITLE_MAX = 80;
const CURRENCY_MARKS: Record<string, string> = {
	"€": "EUR",
	"£": "GBP",
};

/**
 * Turns the number as written ("1.234,56", "12,50", "1,234", "12") into the
 * canonical "1234.56". A lone separator followed by three digits is a group
 * mark ("1,234"); followed by one or two it is the decimal point. Strings
 * only: no float ever touches an amount.
 */
export function canonicalAmount(written: string): string | null {
	const text = written.replace(/[\s  ']/g, "");
	if (!/^\d[\d.,]*$/.test(text)) return null;
	const last = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
	let whole = text;
	let fraction = "";
	if (last >= 0) {
		const tail = text.slice(last + 1);
		const both = text.includes(".") && text.includes(",");
		const repeated = text.split(text[last] ?? "").length > 2;
		// "1,234" and "1.234.567" are groups; "1.234,5" and "12,50" end in a decimal point.
		const isGroup = !both && (repeated || tail.length === 3);
		if (!isGroup) {
			if (repeated || tail.length === 0 || tail.length > 2) return null;
			whole = text.slice(0, last);
			fraction = tail;
		}
	}
	// Group marks sit between groups of exactly three digits.
	if (/[.,]/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;
	whole = whole.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
	if (!whole) return null;
	return fraction ? `${whole}.${fraction}` : whole;
}

// A number with an optional currency mark on either side: "$12.50", "12,50 EUR", "USD 9".
const AMOUNT =
	/(?:(\p{Sc})\s?)?\b(\d[\d.,  ]*\d|\d)(?:\s?(\p{Sc}|[A-Z]{3}\b))?/u;
const CODE_BEFORE = /\b([A-Z]{3})\s?$/;

/**
 * "Coffee 4.50 at Blue Bottle" becomes an amount of 4.50 and a note with the
 * rest; the first number that reads as an amount wins. A text with no number
 * is all note. Currency: an ISO code or a euro or pound sign beside the
 * number; a bare "$" is ambiguous, so it names nothing.
 */
export function parseSharedText(
	text: string,
): Pick<ComposerPrefill, "amount" | "currency" | "title"> {
	const flat = text.replace(/\s+/g, " ").trim();
	if (!flat) return {};
	const found = AMOUNT.exec(flat);
	const amount = found ? canonicalAmount(found[2] ?? "") : null;
	if (!found || !amount) return { title: clip(flat) };
	const before = flat.slice(0, found.index);
	const mark = found[1] ?? found[3];
	const codeBefore = mark ? undefined : CODE_BEFORE.exec(before)?.[1];
	const currency = mark
		? (CURRENCY_MARKS[mark] ?? (/^[A-Z]{3}$/.test(mark) ? mark : undefined))
		: codeBefore;
	// The note keeps the rest in order, without the amount or its currency word.
	let rest = `${codeBefore ? before.replace(CODE_BEFORE, "") : before} ${flat.slice(found.index + found[0].length)}`;
	rest = rest.replace(/\s{2,}/g, " ").trim();
	return { amount, currency, title: rest ? clip(rest) : undefined };
}

function clip(text: string): string {
	return text.length > TITLE_MAX
		? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…`
		: text;
}

// The JSON the native side stores until the app asks for it.
interface Pending {
	kind: "share" | "add";
	text?: string;
	file?: Partial<SharedFile>;
	amount?: string | number;
}

/**
 * Reads the native hand-off. A shared text becomes amount and note; a shared
 * file rides along (and, with no text, opens an empty expense); an App Intent
 * "Add expense" carries its optional amount. Anything unreadable is null.
 */
export function parsePending(json: string | null): ComposerPrefill | null {
	if (!json) return null;
	let pending: Pending;
	try {
		pending = JSON.parse(json) as Pending;
	} catch {
		return null;
	}
	if (pending.kind === "add") {
		const amount = canonicalAmount(String(pending.amount ?? ""));
		return amount ? { mode: "expense", amount } : { mode: "expense" };
	}
	if (pending.kind !== "share") return null;
	const file = pending.file?.uri
		? {
				uri: pending.file.uri,
				mime: pending.file.mime ?? "application/octet-stream",
				name: pending.file.name ?? "",
			}
		: undefined;
	const fromText = pending.text ? parseSharedText(pending.text) : {};
	if (!file && !fromText.title && !fromText.amount) return null;
	return { mode: "expense", ...fromText, file };
}
