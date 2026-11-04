import {
	formatRate,
	formatRateValue,
	orientRate,
	orientRateAs,
	type RateInput,
} from "@retrospend/domain/rate-format";
import { readDollar } from "./dollarRead";

// The same functions the app's rate formatter wraps, in English.
const locale = "en";
const fmt = {
	rate: (from: string, to: string, perFrom: RateInput) =>
		formatRate(from, to, perFrom, locale),
	direction: orientRate,
	inUnit: (base: string, from: string, to: string, perFrom: RateInput) => {
		const o = orientRateAs(base, from, to, perFrom);
		return o ? `${formatRateValue(o.value, locale)} ${o.quote}` : null;
	},
} as unknown as Parameters<typeof readDollar>[1];

describe("readDollar", () => {
	it("leaves a weak home currency to the server's figure", () => {
		const read = readDollar(
			{
				value: { minor: 154500, currency: "ARS" },
				home: "ARS",
				others: [{ rateType: "mep", value: { minor: 148000, currency: "ARS" } }],
			},
			fmt,
		);
		expect(read).toEqual({ sentence: null, others: [null] });
	});

	it("turns a home currency worth more than a dollar around: 1 EUR = 1.25 USD", () => {
		// 0.80 EUR per USD is 1.25 USD per EUR; 0.50 per USD is 2 USD per EUR.
		const read = readDollar(
			{
				value: { minor: 80, currency: "EUR" },
				home: "EUR",
				others: [{ rateType: "card", value: { minor: 50, currency: "EUR" } }],
			},
			fmt,
		);
		expect(read.sentence).toBe("1 EUR = 1.25 USD");
		expect(read.others).toEqual(["2.00 USD"]);
	});

	it("says nothing while there is no rate", () => {
		expect(
			readDollar({ value: null, home: "EUR", others: [] }, fmt),
		).toEqual({ sentence: null, others: [] });
	});
});
