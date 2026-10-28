// Cases too large for the shared vectors file. Everything else lives in
// packages/domain/vectors/money-parse.vectors.json.
import { describe, expect, it } from "vitest";
import { formatMoneyDraft, parseMoneyInput } from "./parse";

describe("parseMoneyInput nesting", () => {
	it("refuses deep nesting as syntax instead of overflowing the stack", () => {
		for (const text of [
			`${"(".repeat(20000)}1${")".repeat(20000)}`,
			`${"(".repeat(20000)}1`,
			`${"-".repeat(20000)}1`,
			`${"+".repeat(20000)}1`,
			`1*${"-(".repeat(10000)}1`,
		]) {
			expect(parseMoneyInput(text, "en-US", "USD")).toEqual({
				ok: false,
				error: "syntax",
			});
		}
	});

	it("allows nesting up to 64 levels", () => {
		const text = `${"(".repeat(63)}12${")".repeat(63)}`;
		expect(parseMoneyInput(text, "en-US", "USD")).toMatchObject({
			ok: true,
			minor: 1200,
		});
		const deeper = `${"(".repeat(65)}12${")".repeat(65)}`;
		expect(parseMoneyInput(deeper, "en-US", "USD")).toEqual({
			ok: false,
			error: "syntax",
		});
	});

	it("drafts deep nesting without overflowing the stack", () => {
		const text = `${"(".repeat(20000)}1234`;
		expect(formatMoneyDraft(text, "en-US", "USD")).toBe(
			`${"(".repeat(20000)}1,234`,
		);
	});
});

describe("parseMoneyInput home symbol", () => {
	it("accepts the home currency's symbol on a home amount", () => {
		expect(parseMoneyInput("$1,500", "en-US-x-hc-usd", "USD")).toEqual({
			ok: true,
			minor: 150000,
			expression: false,
		});
		expect(parseMoneyInput("$ 1.500,50", "es-AR-x-hc-ars", "ARS")).toEqual({
			ok: true,
			minor: 150050,
			expression: false,
		});
	});

	it("refuses the symbol on a foreign amount or without a home currency", () => {
		expect(parseMoneyInput("$1,500", "en-US-x-hc-usd", "EUR")).toEqual({
			ok: false,
			error: "invalidCharacter",
		});
		expect(parseMoneyInput("$1,500", "en-US", "USD")).toEqual({
			ok: false,
			error: "invalidCharacter",
		});
	});
});
