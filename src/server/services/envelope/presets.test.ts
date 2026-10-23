import { describe, expect, it } from "vitest";
import { setupPresetOutputSchema } from "~/lib/schemas/envelope";
import { stylePreset } from "./presets";

const templates = [
	{
		id: "t-rent",
		name: "Rent",
		categoryId: "c-housing",
		frequency: "MONTHLY" as const,
	},
	{
		id: "t-net",
		name: "Internet",
		categoryId: "c-utilities",
		frequency: "MONTHLY" as const,
	},
	{
		id: "t-power",
		name: "Power",
		categoryId: "c-utilities",
		frequency: "QUARTERLY" as const,
	},
	{
		id: "t-gym",
		name: "Gym",
		categoryId: "c-health",
		frequency: "WEEKLY" as const,
	},
];
const categories = [
	{ id: "c-housing", name: "Housing", isFixed: true },
	{ id: "c-utilities", name: "Utilities", isFixed: true },
	{ id: "c-insurance", name: "Insurance", isFixed: true },
	{ id: "c-groceries", name: "Groceries", isFixed: false },
	{ id: "c-dining", name: "Dining", isFixed: false },
];

const preset = (style: "FLEX" | "EVERY_DOLLAR" | "WEEKLY") =>
	stylePreset({ style, currency: "ARS", templates, categories });

describe("style presets (SPEC §4.2)", () => {
	it("Flex: three rows (Bills, Spending, Savings); bills follow monthly templates; Spending is the default", () => {
		const p = preset("FLEX");
		expect(setupPresetOutputSchema.parse(p)).toEqual(p);
		expect(p.groups.map((g) => [g.key, g.role])).toEqual([
			["bills", "BILLS"],
			["spending", "SPENDING"],
			["savings", "SAVINGS"],
		]);
		expect(
			p.envelopes.map((e) => [
				e.key,
				e.groupKey,
				e.kind,
				e.isDefault,
				e.categoryIds,
			]),
		).toEqual([
			["bill-t-rent", "bills", "BILL", false, ["c-housing"]],
			["bill-t-net", "bills", "BILL", false, ["c-utilities"]],
			// Utilities is already Internet's: Power keeps no category link.
			["bill-t-power", "bills", "BILL", false, []],
			// The weekly gym template cannot be a monthly bill.
			["spending", "spending", "MONTHLY", true, []],
			["savings", "savings", "SAVINGS", false, []],
		]);
		expect(p.envelopes[0]?.target).toEqual({
			kind: "BILL_TEMPLATE",
			templateId: "t-rent",
		});
		expect(p.envelopes.find((e) => e.key === "spending")?.target).toBeNull();
	});

	it("Weekly: as Flex, with Spending on a per-week target", () => {
		const spending = preset("WEEKLY").envelopes.find((e) => e.isDefault);
		expect(spending?.target).toEqual({
			kind: "MONTHLY",
			amountMinor: 0,
			mode: "REFILL",
			cadence: "WEEK",
		});
	});

	it("Every dollar: one envelope per category, fixed ones under Bills, plus Everything else", () => {
		const p = preset("EVERY_DOLLAR");
		expect(p.groups.map((g) => g.key)).toEqual([
			"bills",
			"everyday",
			"savings",
		]);
		expect(p.envelopes.map((e) => [e.key, e.groupKey, e.isDefault])).toEqual([
			["bill-t-rent", "bills", false],
			["bill-t-net", "bills", false],
			["bill-t-power", "bills", false],
			["cat-c-insurance", "bills", false],
			["cat-c-groceries", "everyday", false],
			["cat-c-dining", "everyday", false],
			["else", "everyday", true],
			["savings", "savings", false],
		]);
	});
});

describe("P5 presets (SPEC §4.2)", () => {
	it("Save first: Savings first, Bills, one Spending envelope; 20% to Savings and the rest to Spending", () => {
		const p = stylePreset({ style: "SAVE_FIRST", currency: "ARS", templates, categories });
		expect(setupPresetOutputSchema.parse(p)).toEqual(p);
		expect(p.groups.map((g) => g.key)).toEqual(["savings", "bills", "spending"]);
		expect(p.envelopes.map((e) => [e.key, e.isDefault])).toEqual([
			["savings", false],
			["bill-t-rent", false],
			["bill-t-net", false],
			["bill-t-power", false],
			["spending", true],
		]);
		expect(p.rules?.map((r) => [r.envelopeKey, r.action])).toEqual([
			["savings", { kind: "PERCENT", basisPoints: 2_000 }],
			["spending", { kind: "REMAINDER" }],
		]);
	});

	it("50/30/20: Needs 50%, Wants 30%, Savings 20%; fixed categories start in Needs", () => {
		const p = stylePreset({ style: "FIFTY_THIRTY_TWENTY", currency: "ARS", templates, categories });
		expect(setupPresetOutputSchema.parse(p)).toEqual(p);
		expect(p.groups.map((g) => [g.key, g.target])).toEqual([
			["needs", { kind: "PERCENT_OF_INCOME", basisPoints: 5_000 }],
			["wants", { kind: "PERCENT_OF_INCOME", basisPoints: 3_000 }],
			["savings", { kind: "PERCENT_OF_INCOME", basisPoints: 2_000 }],
		]);
		expect(p.envelopes.map((e) => [e.key, e.isDefault, e.categoryIds])).toEqual([
			["needs", false, ["c-housing", "c-utilities", "c-insurance"]],
			["wants", true, ["c-groceries", "c-dining"]],
			["savings", false, []],
		]);
	});
});

describe("Limits preset (SPEC §4.2, A2)", () => {
	const cats = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
		id,
		name: id.toUpperCase(),
		isFixed: false,
	}));
	// 3-month totals in cents; h spent nothing.
	const spent = new Map([
		["a", 60_000],
		["b", 126_001],
		["c", 30_000],
		["d", 9_000],
		["e", 3_000],
		["f", 300],
		["g", 150],
	]);
	const p = stylePreset({
		style: "LIMITS",
		currency: "USD",
		templates,
		categories: cats,
		spent,
		unit: 100,
	});

	it("the top 6 categories by spending, each a Set aside limit of its average rounded up to whole dollars", () => {
		expect(setupPresetOutputSchema.parse(p)).toBeTruthy();
		const limited = p.envelopes.filter((e) => !e.isDefault);
		expect(limited.map((e) => e.categoryIds[0])).toEqual([
			"b",
			"a",
			"c",
			"d",
			"e",
			"f",
		]);
		// 126,001 / 3 = 42,000.33 -> 42,100; 60,000 / 3 = 20,000; 300 / 3 = 100.
		expect(limited.map((e) => e.target)).toMatchObject([
			{ kind: "MONTHLY", mode: "SET_ASIDE", amountMinor: 42_100 },
			{ amountMinor: 20_000 },
			{ amountMinor: 10_000 },
			{ amountMinor: 3_000 },
			{ amountMinor: 1_000 },
			{ amountMinor: 100 },
		]);
	});

	it("Everything else covers the rest with no limit; one Limits group", () => {
		expect(p.envelopes.find((e) => e.isDefault)).toMatchObject({
			key: "else",
			target: null,
			groupKey: "limits",
		});
		expect(p.groups).toEqual([
			{ key: "limits", nameKey: "envelope.groups.limits", role: "SPENDING" },
		]);
	});
});
