import { describe, expect, it } from "vitest";
import { PROBLEM_STATUS, problemType } from "./errors";
import { isValidIdempotencyKey, isWriteMethod } from "./idempotency";
import { convertedMoneySchema, moneySchema } from "./money";
import { cursorQuerySchema } from "./pagination";
import { parseScopeList } from "./scopes";

describe("money DTO", () => {
	it("takes integer minor units up to the safe range", () => {
		// 21M BTC in satoshis: 21e6 * 1e8 = 2.1e15, inside 2^53 - 1.
		expect(
			moneySchema.parse({ minor: 2_100_000_000_000_000, currency: "BTC" }),
		).toEqual({ minor: 2_100_000_000_000_000, currency: "BTC" });
		expect(moneySchema.parse({ minor: -123450, currency: "ARS" }).minor).toBe(
			-123450,
		);
	});

	it("rejects floats, unsafe integers and lowercase codes", () => {
		expect(
			moneySchema.safeParse({ minor: 12.5, currency: "USD" }).success,
		).toBe(false);
		expect(
			moneySchema.safeParse({ minor: 2 ** 53, currency: "USD" }).success,
		).toBe(false);
		expect(moneySchema.safeParse({ minor: 1, currency: "usd" }).success).toBe(
			false,
		);
	});

	it("carries the rate as a decimal string", () => {
		const converted = {
			original: { minor: 1000, currency: "USD" },
			home: { minor: 1_450_000, currency: "ARS" },
			rate: "1450",
			rateType: "blue",
			rateDate: "2026-10-22",
		};
		expect(convertedMoneySchema.parse(converted)).toEqual(converted);
		expect(
			convertedMoneySchema.safeParse({ ...converted, rate: 1450 }).success,
		).toBe(false);
	});
});

describe("scopes", () => {
	it("parses a space-separated list and reports unknown scopes", () => {
		expect(parseScopeList("read  write:money read bogus")).toEqual({
			scopes: ["read", "write:money"],
			unknown: ["bogus"],
		});
		expect(parseScopeList(undefined)).toEqual({ scopes: [], unknown: [] });
	});
});

describe("pagination", () => {
	it("defaults and bounds the limit", () => {
		expect(cursorQuerySchema.parse({})).toEqual({ limit: 50 });
		expect(cursorQuerySchema.parse({ limit: "10" }).limit).toBe(10);
		expect(cursorQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
	});
});

describe("problem codes", () => {
	it("maps each code to one status and a URN type", () => {
		expect(PROBLEM_STATUS.missing_scope).toBe(403);
		expect(PROBLEM_STATUS.rate_limited).toBe(429);
		expect(problemType("not_found")).toBe("urn:retrospend:problem:not_found");
	});
});

describe("idempotency", () => {
	it("accepts printable keys up to 255 characters", () => {
		expect(isValidIdempotencyKey("2f1c-uuid")).toBe(true);
		expect(isValidIdempotencyKey("a".repeat(255))).toBe(true);
		expect(isValidIdempotencyKey("a".repeat(256))).toBe(false);
		expect(isValidIdempotencyKey("has space")).toBe(false);
		expect(isValidIdempotencyKey("")).toBe(false);
	});

	it("treats every method but GET and HEAD as a write", () => {
		expect(isWriteMethod("post")).toBe(true);
		expect(isWriteMethod("DELETE")).toBe(true);
		expect(isWriteMethod("GET")).toBe(false);
		expect(isWriteMethod("HEAD")).toBe(false);
	});
});
