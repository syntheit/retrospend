import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import {
	NUMBER_FORMATS,
	type NumberFormatChoice,
	withNumberFormat,
} from "./format-locale";
import { draftFromMinor, parseMoneyInput } from "./parse";

// What the app shows must be what the keypad reads back: for every language
// and every number format (or none), a formatted amount parses to the same
// minor units, and so does the editable draft of it.
const LOCALES = [
	"en-US",
	"es-AR",
	"de",
	"fr",
	"ru",
	"en-IN",
	"de-CH",
	"pt-PT",
	"es-ES",
	"ar-EG",
	"hi-IN",
	"ja-JP",
	"pl",
];
const CHOICES: (NumberFormatChoice | null)[] = [null, ...NUMBER_FORMATS];
const AMOUNTS: [number, string][] = [
	[123456, "USD"],
	[192030, "EUR"],
	[1234567, "JPY"],
	[1234567, "KWD"],
	[123456789012, "USD"],
	[5, "USD"],
	[12345678, "BTC"],
	[123456750, "ARS"],
];

describe("number format round trip", () => {
	for (const base of LOCALES) {
		for (const choice of CHOICES) {
			const locale = withNumberFormat(base, choice);
			it(`${base} ${choice ?? "follow"}`, () => {
				for (const [minor, currency] of AMOUNTS) {
					for (const cents of [true, "auto"] as const) {
						const shown = formatMoney(
							{ minor, currency },
							{ locale, display: "none", cents },
						);
						expect(
							parseMoneyInput(shown, locale, currency),
							`${shown} (${currency} ${minor})`,
						).toMatchObject({ ok: true, minor });
					}
					const draft = draftFromMinor(minor, locale, currency);
					expect(
						parseMoneyInput(draft, locale, currency),
						`draft ${draft} (${currency} ${minor})`,
					).toMatchObject({ ok: true, minor });
				}
			});
		}
	}
});
