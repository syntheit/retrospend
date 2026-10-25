import { rateToText } from "./rate-text";

/**
 * The rate fields the old expense form sends on save. A rate typed by hand
 * goes as its text (`customRate`) and the number the form previews with stays
 * home; any other rate goes as decimal text too, so no rate is a float on the
 * wire.
 */
export function legacyRateWire(form: {
	exchangeRate?: number;
	pricingSource?: string;
	customRate?: { base: string; value: string };
}): { exchangeRate?: string; customRate?: { base: string; value: string } } {
	if (form.customRate && form.pricingSource === "custom") {
		return { customRate: form.customRate };
	}
	const text = form.exchangeRate ? rateToText(form.exchangeRate) : null;
	return text ? { exchangeRate: text } : {};
}
