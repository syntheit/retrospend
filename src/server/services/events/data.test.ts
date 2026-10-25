import { EVENT_TYPES, isEventTypeName } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { amountsOfChanges, extractEventData } from "./data";
import { MUTATION_EVENTS } from "./mutation-events";

describe("extractEventData", () => {
	it("keeps ids and Money and drops every other string", () => {
		const { entityId, data } = extractEventData({
			id: "exp_1",
			title: "Dinner with Ana at Casa Pepe",
			notes: "she owes me for the wine",
			categoryId: "cat_9",
			amount: { minor: 12550, currency: "ARS" },
			home: { minor: 9, currency: "USD" },
			place: "Casa Pepe",
		});
		expect(entityId).toBe("exp_1");
		expect(data.ids).toEqual({ categoryId: "cat_9" });
		expect(data.amounts).toEqual([
			{ name: "amount", minor: 12550, currency: "ARS" },
			{ name: "home", minor: 9, currency: "USD" },
		]);
		expect(JSON.stringify(data)).not.toMatch(/Dinner|Pepe|wine|Ana/);
	});

	it("takes an id only from a key named like an id, and only if it looks like one", () => {
		const { data } = extractEventData({
			paymentId: "has spaces so it is text",
			noteId: "ok-1",
			memo: "abc",
			accountName: "Savings",
		});
		expect(data.ids).toEqual({ noteId: "ok-1" });
	});

	it("walks nested results, shallowest id first, and names fields by path", () => {
		const { entityId, data } = extractEventData({
			value: {
				id: "p1",
				person: { id: "u2" },
				fee: { minor: 5, currency: "USD" },
			},
			plan: { op: "x", args: { title: "Undo me", id: "zzz" } },
			stamp: "abc",
		});
		expect(entityId).toBe("p1");
		expect(data.ids).toEqual({ "value.person.id": "u2" });
		expect(data.amounts).toEqual([
			{ name: "value.fee", minor: 5, currency: "USD" },
		]);
	});

	it("ignores keys that are not plain identifiers, so user text cannot become a name", () => {
		const { entityId, data } = extractEventData({
			byCategory: {
				"Coffee and snacks": { id: "c1", otherId: "x1" },
				"a.b": { id: "c2", otherId: "x2" },
				ok: { id: "c3", otherId: "x3" },
			},
		});
		expect(entityId).toBe("c3");
		expect(data.ids).toEqual({ "byCategory.ok.otherId": "x3" });
	});

	it("skips dates, decimals and class instances, and a non-integer Money", () => {
		class Decimalish {
			id = "should-not-be-read";
		}
		const { entityId, data } = extractEventData({
			at: new Date(),
			d: new Decimalish(),
			bad: { minor: 1.5, currency: "USD" },
			worse: { minor: 5, currency: "usd dollars" },
		});
		expect(entityId).toBeNull();
		expect(data).toEqual({ ids: {}, amounts: [], truncated: false });
	});

	it("caps ids and amounts and says so", () => {
		const many = Object.fromEntries(
			Array.from({ length: 40 }, (_, i) => [`k${i}Id`, `id${i}`]),
		);
		const { data } = extractEventData(many);
		expect(Object.keys(data.ids)).toHaveLength(32);
		expect(data.truncated).toBe(true);
	});

	it("stops at a fixed depth", () => {
		const deep = { a: { b: { c: { d: { e: { f: { id: "deep" } } } } } } };
		expect(extractEventData(deep).entityId).toBeNull();
	});
});

describe("amountsOfChanges", () => {
	it("lists signed deltas and drops figures that did not move", () => {
		expect(
			amountsOfChanges([
				{ id: "owed.owedToYou", delta: { minor: -500, currency: "ARS" } },
				{ id: "netWorth", delta: { minor: 0, currency: "ARS" } },
			]),
		).toEqual([{ name: "owed.owedToYou", minor: -500, currency: "ARS" }]);
	});
});

describe("MUTATION_EVENTS", () => {
	it("names only registered event types", () => {
		const registered = new Set<string>(EVENT_TYPES);
		for (const [mutation, type] of Object.entries(MUTATION_EVENTS)) {
			expect(isEventTypeName(type), mutation).toBe(true);
			expect(registered.has(type), `${mutation} -> ${type}`).toBe(true);
		}
	});
});
