import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money";
import { noRateFound } from "./refusals";
import {
	NoRateFoundError,
	reopenRate,
	resolveAccountRate,
	usdKeepsRateType,
} from "./resolve-rate";

const DAY = new Date("2026-11-10T00:00:00Z");
const blue = { rate: 1545, type: "blue", date: DAY, onOrBefore: true };
const find = async () => blue;
const none = async () => null;

describe("resolveAccountRate", () => {
	it("is 1 with no type for USD, whatever the table or the typed rate says", async () => {
		expect(
			await resolveAccountRate("USD", DAY, { rate: "5", type: "custom" }, none),
		).toEqual({ rate: 1, rateType: null });
	});

	it("uses a usable typed rate as typed when the type is custom", async () => {
		expect(
			await resolveAccountRate(
				"ARS",
				DAY,
				{ rate: "1412.5", type: "custom" },
				find,
			),
		).toEqual({ rate: 1412.5, rateType: "custom" });
	});

	it("looks in the table for a typed rate that is not usable, or a type that is not custom", async () => {
		expect(
			await resolveAccountRate("ARS", DAY, { rate: "0", type: "custom" }, find),
		).toEqual({ rate: 1545, rateType: "blue" });
		expect(
			await resolveAccountRate(
				"ARS",
				DAY,
				{ rate: "9", type: "official" },
				find,
			),
		).toEqual({ rate: 1545, rateType: "blue" });
	});

	it("asks the table for the type the person prefers", async () => {
		let asked: string | null | undefined;
		await resolveAccountRate(
			"ARS",
			DAY,
			{ type: "official" },
			async (_c, _d, t) => {
				asked = t;
				return blue;
			},
		);
		expect(asked).toBe("official");
	});

	it("throws, never 1, when there is no rate at all", async () => {
		const error = await resolveAccountRate("BRL", DAY, {}, none).catch(
			(e) => e,
		);
		expect(error).toBeInstanceOf(NoRateFoundError);
		expect(error.currency).toBe("BRL");
		expect(error.message).toBe(noRateFound("BRL"));
	});
});

describe("usdKeepsRateType", () => {
	const resolved = { rate: 1, rateType: null };

	it("keeps the type asked for on a USD account", () => {
		expect(usdKeepsRateType("USD", resolved, "blue")).toEqual({
			rate: 1,
			rateType: "blue",
		});
		expect(usdKeepsRateType("USD", resolved, undefined)).toEqual({
			rate: 1,
			rateType: null,
		});
	});

	it("leaves another currency as resolved", () => {
		const r = { rate: 1545, rateType: "blue" };
		expect(usdKeepsRateType("ARS", r, "official")).toBe(r);
	});
});

describe("reopenRate", () => {
	it("is today's rate of the account's type", async () => {
		expect(
			await reopenRate(async () => ({ rate: 1545, rateType: "blue" }), {
				currency: "ARS",
				exchangeRate: "1000",
			}),
		).toBe(1545);
	});

	it("falls back to the stored rate when none resolves", async () => {
		expect(
			await reopenRate(
				async () => {
					throw new NoRateFoundError("BRL");
				},
				{ currency: "BRL", exchangeRate: "5.5" },
			),
		).toBe("5.5");
	});

	it("is a missing rate, never 1, when the stored rate is absent or unusable", async () => {
		for (const exchangeRate of [null, "0"])
			await expect(
				reopenRate(
					async () => {
						throw new NoRateFoundError("BRL");
					},
					{ currency: "BRL", exchangeRate },
				),
			).rejects.toThrow(MissingRateError);
	});
});
