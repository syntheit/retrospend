import { formatToPartsFallback } from "./intl-polyfill";

// The fallback must give what the real formatToParts gives, for the shapes
// the domain formatter uses.
const cases: [string, Intl.NumberFormatOptions, number][] = [
	["en-US", { numberingSystem: "latn" }, 123456789.5],
	["es-AR", { numberingSystem: "latn" }, 123456789.5],
	["de-DE", { numberingSystem: "latn" }, 123456789.5],
	["fr-FR", { numberingSystem: "latn" }, 123456789.5],
	["en-IN", { numberingSystem: "latn" }, 123456789.5],
	["pt-BR", { numberingSystem: "latn" }, 1234.5],
	["en-US", { style: "currency", currency: "EUR" }, 1],
	["de-DE", { style: "currency", currency: "EUR" }, 1],
	["es-AR", { style: "currency", currency: "ARS" }, -1234.5],
	["en-US", { style: "percent", numberingSystem: "latn" }, 0.5],
	["de-DE", { style: "percent", numberingSystem: "latn" }, 0.5],
	["en-US", { notation: "compact", numberingSystem: "latn" }, 1_000_000],
	["fr-FR", { notation: "compact", numberingSystem: "latn" }, 1_000_000],
	["es-AR", { notation: "compact", numberingSystem: "latn" }, 1_000_000],
];

describe("formatToPartsFallback", () => {
	it.each(cases)("%s %j %d", (locale, options, value) => {
		const format = new Intl.NumberFormat(locale, options);
		expect(formatToPartsFallback(format, value)).toEqual(
			format.formatToParts(value),
		);
	});
});
