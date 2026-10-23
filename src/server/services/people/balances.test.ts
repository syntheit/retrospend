/**
 * The People reads' pure parts, with values worked out by hand. Quotes are
 * ARS per unit: BRL 271 (blue), USD 1,468 (blue). Minor units: ARS and BRL
 * and USD have 2 decimals, so ARS 10,000.00 is 1,000,000.
 */
import { describe, expect, it } from "vitest";
import { quote } from "~/server/services/payments/allocate";
import { ledgerLines } from "~/server/services/payments/ledger";
import {
	balanceParts,
	barSegments,
	groupOf,
	netOf,
	rateOf,
	unpricedOf,
} from "./balances";
import { effectOf } from "./ledger-rows";
import { suggestedDirection } from "./settle-context";

const QUOTES = new Map([
	["BRL", quote("271", "blue")],
	["USD", quote("1468", "blue")],
]);

describe("balanceParts and netOf", () => {
	it("values each currency at its quote and nets them in ARS, home first", () => {
		// ARS +10,000; BRL +100 = ARS 27,100; USD -20 = ARS -29,360.
		const parts = balanceParts(
			new Map([
				["USD", -2000],
				["BRL", 10_000],
				["ARS", 1_000_000],
			]),
			"ARS",
			QUOTES,
		);
		expect(parts.map((p) => p.amount.currency)).toEqual(["ARS", "BRL", "USD"]);
		expect(parts.map((p) => p.home?.minor)).toEqual([
			1_000_000, 2_710_000, -2_936_000,
		]);
		expect(parts[1]?.rate).toEqual({
			type: "blue",
			unit: { minor: 100, currency: "BRL" },
			value: { minor: 27_100, currency: "ARS" },
		});
		// 10,000 + 27,100 - 29,360 = ARS 7,740.
		expect(netOf(parts, "ARS")).toEqual({ minor: 774_000, currency: "ARS" });
	});

	it("keeps a currency with no rate out of the net (a missing rate is never 1)", () => {
		const parts = balanceParts(
			new Map([
				["ARS", -500_000],
				["EUR", 3000],
			]),
			"ARS",
			QUOTES,
		);
		expect(parts[1]).toEqual({
			amount: { minor: 3000, currency: "EUR" },
			home: null,
			rate: null,
		});
		expect(netOf(parts, "ARS")).toBeNull();
		expect(unpricedOf([parts, []])).toEqual(["EUR"]);
		// No net: owing anything to you puts them under Owe you.
		expect(groupOf(parts, null, false)).toBe("owed");
	});

	it("drops zero lines", () => {
		expect(balanceParts(new Map([["ARS", 0]]), "ARS", QUOTES)).toEqual([]);
	});
});

describe("groupOf", () => {
	const ars = (minor: number) => [
		{
			amount: { minor, currency: "ARS" },
			home: { minor, currency: "ARS" },
			rate: null,
		},
	];
	it("follows the sign of the net", () => {
		expect(groupOf(ars(100), { minor: 100 }, false)).toBe("owed");
		expect(groupOf(ars(-100), { minor: -100 }, true)).toBe("owe");
	});
	it("is Pending with no balance while a payment waits, else Settled", () => {
		expect(groupOf([], { minor: 0 }, true)).toBe("pending");
		expect(groupOf([], { minor: 0 }, false)).toBe("settled");
	});
});

describe("barSegments", () => {
	it("sizes each person by their part of owed plus owe, owed side first", () => {
		const ars = (minor: number) => ({ minor, currency: "ARS" });
		// Owed to you 900, you owe 100: A 600 = 60%, B 300 = 30%, C 100 = 10%.
		const segments = barSegments(
			[
				{ key: "user:b", net: ars(300) },
				{ key: "user:c", net: ars(-100) },
				{ key: "user:a", net: ars(600) },
				{ key: "shadow:d", net: null },
				{ key: "user:e", net: ars(0) },
			],
			900,
			100,
		);
		expect(segments).toEqual([
			{ key: "user:a", direction: "owed", share: 6000, amount: ars(600) },
			{ key: "user:b", direction: "owed", share: 3000, amount: ars(300) },
			{ key: "user:c", direction: "owe", share: 1000, amount: ars(100) },
		]);
	});

	it("gives a tiny balance one basis point so it never vanishes", () => {
		const segments = barSegments(
			[{ key: "user:a", net: { minor: 1, currency: "ARS" } }],
			1_000_000,
			0,
		);
		expect(segments[0]?.share).toBe(1);
	});

	it("is empty when nothing is open", () => {
		expect(barSegments([], 0, 0)).toEqual([]);
	});
});

describe("rateOf", () => {
	it("is null without a quote", () => {
		expect(rateOf("EUR", "ARS", undefined)).toBeNull();
	});
});

describe("effectOf", () => {
	const mine = new Set(["user:me", "shadow:old-me"]);
	const theirs = new Set(["user:lucia"]);
	const tx = (paidBy: string) => {
		const [paidByType, paidById] = paidBy.split(":") as [string, string];
		return {
			paidByType,
			paidById,
			amount: "300",
			currency: "ARS",
			splitParticipants: [
				{
					participantType: "shadow",
					participantId: "old-me",
					shareAmount: "100",
				},
				{ participantType: "user", participantId: "lucia", shareAmount: "100" },
				{ participantType: "user", participantId: "paz", shareAmount: "100" },
			],
		};
	};
	it("is their share when you paid", () => {
		expect(effectOf(tx("user:me"), mine, theirs)).toBe(10_000);
	});
	it("is minus your share (any of your aliases) when they paid", () => {
		expect(effectOf(tx("user:lucia"), mine, theirs)).toBe(-10_000);
	});
	it("is null when someone else paid", () => {
		expect(effectOf(tx("user:paz"), mine, theirs)).toBeNull();
	});
});

describe("suggestedDirection", () => {
	const line = (currency: string, minor: number) => ({
		date: "2026-10-01",
		scope: null,
		currency,
		minor,
		kind: "share" as const,
	});
	it("follows the net in the payment currency", () => {
		// They owe ARS 1,000 but you owe BRL 10 = ARS 2,710: you pay.
		const lines = ledgerLines([line("ARS", 100_000), line("BRL", -1000)]);
		expect(suggestedDirection(lines, "ARS", QUOTES)).toBe("outgoing");
	});
	it("is null when nothing is open", () => {
		expect(suggestedDirection([], "ARS", QUOTES)).toBeNull();
	});
});
