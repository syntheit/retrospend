import type { RateChoice } from "./draft";
import type { RateOptions } from "./hooks";

type Money = { minor: number; currency: string };
type RateOption = RateOptions["options"][number];

/** The rate row the composer shows under the amount, read from the server's options. */
export interface RateView {
	/** The type shown as picked: the person's pick, else the pair's default. */
	type: string | null;
	/** The picked option with its rate, when the server sent one. */
	picked: RateOption | null;
	/** The amount at home as the server booked it; null until it says. */
	home: Money | null;
	/** No rate at all for the pair and none typed: Save waits for one. */
	missing: boolean;
	/** The picked type is not the pair's default (the guideline names it then). */
	notDefault: boolean;
}

/**
 * What the rate row says, from GET /entry/rate-options and the draft's
 * choice. Every number in it is the server's: the home value is the amount
 * booked at the picked type (or at the typed rate), never a product taken
 * here. An edit that keeps a saved custom rate shows the value it was saved
 * with (`keptHome`) until the rate is touched.
 */
export function rateView(
	options: RateOptions | null,
	choice: RateChoice,
	keptHome: Money | null = null,
): RateView {
	const kept = !choice.custom && choice.rateType === "custom";
	const type = choice.custom
		? "custom"
		: (choice.rateType ?? options?.defaultType ?? null);
	const picked = choice.custom
		? (options?.custom ?? null)
		: (options?.options.find((o) => o.rateType === type) ?? null);
	return {
		type,
		picked,
		home: picked?.home ?? (kept ? keptHome : null),
		missing: !!options?.missing && !choice.custom && !kept,
		notDefault:
			type !== null &&
			options !== null &&
			options.defaultType !== null &&
			type !== options.defaultType,
	};
}
