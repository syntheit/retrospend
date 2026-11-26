import { describe, expect, it } from "vitest";
import { type RateSwitchRow, rateSwitchPlan } from "./rate-switch-plan";

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (
	id: string,
	from: string,
	type: string | null,
	previousType: string | null,
	hour = 10,
): RateSwitchRow => ({
	id,
	from: at(from),
	type,
	previousType,
	createdAt: new Date(`${from}T${String(hour).padStart(2, "0")}:00:00.000Z`),
});

// official before any switch, then blue from March, then mep from May.
const A = row("a", "2026-03-01", "blue", "official");
const B = row("b", "2026-05-01", "mep", "blue");

describe("rateSwitchPlan", () => {
	it("the first switch of an account chains from the type it has", () => {
		expect(
			rateSwitchPlan({
				rows: [],
				current: "blue",
				from: at("2026-04-01"),
				rateType: "official",
			}),
		).toEqual({
			insert: {
				from: at("2026-04-01"),
				type: "official",
				previousType: "blue",
			},
			repoint: null,
			accountRateType: { value: "official" },
		});
	});

	it("a switch between two repoints the next one and leaves the account's type", () => {
		const plan = rateSwitchPlan({
			rows: [A, B],
			current: "mep",
			from: at("2026-04-01"),
			rateType: "card",
		});
		expect(plan.insert.previousType).toBe("blue");
		expect(plan.repoint).toEqual({ id: "b", previousType: "card" });
		expect(plan.accountRateType).toBeNull();
	});

	it("the latest switch chains from the one before and sets the account's type", () => {
		const plan = rateSwitchPlan({
			rows: [B, A],
			current: "mep",
			from: at("2026-06-01"),
			rateType: "card",
		});
		expect(plan.insert.previousType).toBe("mep");
		expect(plan.repoint).toBeNull();
		expect(plan.accountRateType).toEqual({ value: "card" });
	});

	it("a switch before every row chains from the type before any switch", () => {
		const plan = rateSwitchPlan({
			rows: [A, B],
			current: "mep",
			from: at("2026-02-01"),
			rateType: "card",
		});
		expect(plan.insert.previousType).toBe("official");
		expect(plan.repoint).toEqual({ id: "a", previousType: "card" });
		expect(plan.accountRateType).toBeNull();
	});

	it("a second switch on the same day replaces the first from then on", () => {
		const first = row("first", "2026-03-01", "blue", "official", 9);
		const second = row("second", "2026-03-01", "mep", "blue", 11);
		const plan = rateSwitchPlan({
			rows: [second, first],
			current: "mep",
			from: at("2026-03-01"),
			rateType: "card",
		});
		// The last one written that day is the one in force before the new one.
		expect(plan.insert.previousType).toBe("mep");
		expect(plan.repoint).toBeNull();
		expect(plan.accountRateType).toEqual({ value: "card" });
	});

	it("the default pick is a null type and chains like any other", () => {
		const plan = rateSwitchPlan({
			rows: [A],
			current: "blue",
			from: at("2026-04-01"),
			rateType: null,
		});
		expect(plan.insert).toEqual({
			from: at("2026-04-01"),
			type: null,
			previousType: "blue",
		});
		expect(plan.accountRateType).toEqual({ value: null });
	});

	it("does not reorder or change the rows it was given", () => {
		const rows = [B, A];
		rateSwitchPlan({
			rows,
			current: "mep",
			from: at("2026-04-01"),
			rateType: "x",
		});
		expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
	});
});
