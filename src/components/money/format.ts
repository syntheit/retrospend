/**
 * The seam between the money components and the one formatter (R10,
 * IMPLEMENTATION §2.5): @retrospend/domain/format. Components import from
 * here so the money folder has one place that names the formatter.
 */
import type { Money } from "@retrospend/domain/money-minor";

export {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
	type MoneyDisplay,
	type MoneySign,
} from "@retrospend/domain/format";

/** An amount in ISO minor units, as the server sends it (R9). */
export type MoneyValue = Money;

/** Which way an amount points. A comparison, not money math. */
export function signOf(money: MoneyValue): -1 | 0 | 1 {
	return money.minor > 0 ? 1 : money.minor < 0 ? -1 : 0;
}

/**
 * The attributes the e2e figure audit reads off every rendered number:
 * which figure it is (a key from the figures registry), its minor units and
 * its currency. A percent uses hundredths of a percent with currency "%".
 */
export type FigureAttrs = {
	"data-figure"?: string;
	"data-minor"?: number;
	"data-currency"?: string;
};

export function figureAttrs(
	figure: string | undefined,
	value: { minor: number; currency: string } | null,
): FigureAttrs {
	return {
		"data-figure": figure,
		"data-minor": value?.minor,
		"data-currency": value?.currency,
	};
}
