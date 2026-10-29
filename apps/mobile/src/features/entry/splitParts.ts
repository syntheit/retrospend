import { fromMinor, money } from "@retrospend/domain/money-minor";
import {
	decimalSeparator,
	draftFromMinor,
	parseMoneyInput,
} from "@retrospend/domain/parse";

// What a person types in a custom split, and how it becomes the text the
// server takes. Nothing here divides anything: the server splits and checks
// the total (its dry run says when the parts do not add up).

/** How a split divides, as the server names it. */
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

/** The custom modes, in the order they are offered. */
export const CUSTOM_MODES = ["EXACT", "PERCENTAGE", "SHARES"] as const;

export type ShareFields =
	| { shareAmount: string }
	| { sharePercentage: string }
	| { shareUnits: number };

/** The text of one person's part as the API takes it, or null while it does not read. */
export function shareFields(
	mode: Exclude<SplitMode, "EQUAL">,
	text: string,
	locale: string,
	currency: string,
): ShareFields | null {
	const typed = text.trim();
	if (!typed) return null;
	if (mode === "EXACT") {
		const read = parseMoneyInput(typed, locale, currency);
		if (read.ok) {
			return { shareAmount: fromMinor(money(read.minor, currency)) };
		}
		// A person who owes nothing of it is a valid part.
		return read.error === "zero"
			? { shareAmount: fromMinor(money(0, currency)) }
			: null;
	}
	if (mode === "PERCENTAGE") {
		const plain = typed.replace(decimalSeparator(locale), ".");
		if (!/^\d{1,3}(\.\d{1,4})?$/.test(plain)) return null;
		return Number(plain) <= 100 ? { sharePercentage: plain } : null;
	}
	if (!/^\d{1,6}$/.test(typed)) return null;
	const units = Number(typed);
	return units > 0 ? { shareUnits: units } : null;
}

/** A saved part as the text the field shows. */
export function partText(
	mode: SplitMode,
	saved: {
		share: { minor: number; currency: string };
		percentage: string | null;
		units: number | null;
	},
	locale: string,
): string {
	if (mode === "EXACT") {
		return draftFromMinor(
			Math.abs(saved.share.minor),
			locale,
			saved.share.currency,
		);
	}
	if (mode === "PERCENTAGE") {
		return (saved.percentage ?? "").replace(".", decimalSeparator(locale));
	}
	if (mode === "SHARES") return saved.units === null ? "" : String(saved.units);
	return "";
}
