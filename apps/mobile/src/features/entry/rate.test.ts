import { DEFAULT_RATE } from "./draft";
import type { RateOptions } from "./hooks";
import { rateView } from "./rate";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const usd1 = { minor: 100, currency: "USD" };
const options: RateOptions = {
	homeCurrency: "ARS",
	defaultType: "blue",
	options: [
		{
			rateType: "official",
			rate: { unit: usd1, value: ars(105_000), rate: "1050" },
			home: ars(1_260_000),
		},
		{
			rateType: "blue",
			rate: { unit: usd1, value: ars(146_500), rate: "1465" },
			home: ars(1_758_000),
		},
	],
	missing: null,
	custom: null,
};

describe("rateView: the rate row reads the server's options", () => {
	it("starts on the pair's default type with its home value", () => {
		expect(rateView(options, DEFAULT_RATE)).toMatchObject({
			type: "blue",
			home: ars(1_758_000),
			missing: false,
			notDefault: false,
		});
	});

	it("follows a picked type and says it is not the default", () => {
		const view = rateView(options, { ...DEFAULT_RATE, rateType: "official" });
		expect(view).toMatchObject({
			type: "official",
			home: ars(1_260_000),
			notDefault: true,
		});
	});

	it("shows a typed rate as the server booked it, nothing before it answers", () => {
		const typed = { rateType: null, custom: true, customText: "1200" };
		expect(rateView(options, typed)).toMatchObject({
			type: "custom",
			home: null,
		});
		const booked = {
			...options,
			custom: {
				rateType: "custom",
				rate: { unit: usd1, value: ars(120_000), rate: "1200" },
				home: ars(1_440_000),
			},
		};
		expect(rateView(booked, typed).home).toEqual(ars(1_440_000));
	});

	it("says a pair with no rate is missing until a rate is typed", () => {
		const none = { ...options, options: [], missing: { currency: "USD" } };
		expect(rateView(none, DEFAULT_RATE)).toMatchObject({
			missing: true,
			home: null,
		});
		const typed = { ...DEFAULT_RATE, custom: true, customText: "1" };
		expect(rateView(none, typed).missing).toBe(false);
	});

	it("keeps a saved custom rate's booked value on an edit", () => {
		const kept = { ...DEFAULT_RATE, rateType: "custom" };
		expect(rateView(options, kept, ars(999))).toMatchObject({
			type: "custom",
			home: ars(999),
		});
	});
});
