import * as z from "zod";

/**
 * Money on the wire (IMPLEMENTATION §2.2): an integer count of the
 * currency's minor units plus the currency code. 1234.50 ARS is
 * `{ minor: 123450, currency: "ARS" }`; 0.004 ETH with 8 digits is
 * `{ minor: 400000, currency: "ETH" }`. The largest real values (BTC supply
 * in satoshis, about 2.1e15) stay inside the safe integer range, so a plain
 * JSON number never loses precision. Clients format it with
 * @retrospend/domain and never do arithmetic on it (R9).
 */
export const currencyCodeSchema = z
	.string()
	.regex(/^[A-Z0-9]{2,10}$/)
	.meta({
		id: "CurrencyCode",
		description: "ISO 4217 code, or the app's code for a crypto asset.",
		examples: ["USD", "ARS", "BTC"],
	});

export const moneySchema = z
	.object({
		// z.int() is zod 4's safe integer: it rejects anything past 2^53 - 1.
		minor: z
			.int()
			.meta({ description: "Amount in the currency's minor units." }),
		currency: currencyCodeSchema,
	})
	.meta({
		id: "Money",
		description: "An amount in minor units of one currency.",
		examples: [{ minor: 123450, currency: "ARS" }],
	});

export type Money = z.infer<typeof moneySchema>;

/**
 * Exchange rate types come from the currency pair (official, blue, mep,
 * crypto...), so the contract keeps them an open string.
 */
export const rateTypeSchema = z
	.string()
	.min(1)
	.max(32)
	.meta({ id: "RateType", examples: ["official", "blue"] });

/**
 * An amount with its value in the viewer's home currency. `rate` is a
 * decimal string so no float ever carries it; `rateDate` is the day the
 * rate is from.
 */
export const convertedMoneySchema = z
	.object({
		original: moneySchema,
		home: moneySchema,
		rate: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.meta({ description: "Units of home currency per original unit." }),
		rateType: rateTypeSchema,
		rateDate: z.iso.date(),
	})
	.meta({ id: "ConvertedMoney" });

export type ConvertedMoney = z.infer<typeof convertedMoneySchema>;

/**
 * A named number from the figures registry (src/server/figures). The id
 * (for example `owed.owedToYou`) lets the UI tag it for the display audit.
 */
export const figureIdSchema = z
	.string()
	.regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/)
	.meta({ id: "FigureId", examples: ["owed.owedToYou", "spent"] });

/** The pseudo currency of a percent figure: `minor` is hundredths of a percent. */
export const PERCENT_CURRENCY = "%";

/**
 * One line of a figure: money, or a percent (12.5% is
 * `{ minor: 1250, currency: "%" }`).
 */
export const figureLineSchema = z
	.object({
		minor: z.int(),
		currency: z.union([currencyCodeSchema, z.literal(PERCENT_CURRENCY)]),
	})
	.meta({ id: "FigureLine" });

export type FigureLine = z.infer<typeof figureLineSchema>;

/**
 * A figure as read: one line per currency, sorted by code, never netted
 * across currencies. `lines` is null when the figure cannot be computed
 * (a missing rate), never 0.
 */
export const figureSchema = z
	.object({
		id: figureIdSchema,
		lines: z.array(figureLineSchema).nullable(),
	})
	.meta({ id: "Figure" });

export type Figure = z.infer<typeof figureSchema>;
