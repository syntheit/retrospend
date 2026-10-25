import { describe, expect, it } from "vitest";
import { ACTIONS } from "~/components/actions/registry";
import { CATALOG, compareItems, countByGroup, item, SEAMS } from "./catalog";
import type { NeedsYouType } from "./types";

const ids = (types: NeedsYouType[], dates: (string | null)[] = []) =>
	types.map((type, i) => item(type, { key: `k${i}`, date: dates[i] ?? null }));

describe("Needs you order (RC-11)", () => {
	it("overdue bills, confirms, splits, imports, due today, then budget prompts", () => {
		const shuffled = ids([
			"budget.giveJob",
			"recurring.due",
			"budget.overspent",
			"import.review",
			"split.review",
			"payment.confirm",
			"recurring.overdue",
			"setup.verifyEmail",
		]);
		expect([...shuffled].sort(compareItems).map((i) => i.type)).toEqual([
			"recurring.overdue",
			"payment.confirm",
			"split.review",
			"import.review",
			"recurring.due",
			"budget.overspent",
			"budget.giveJob",
			"setup.verifyEmail",
		]);
	});

	it("within a type: the oldest date first, undated last, then by id", () => {
		const list = [
			item("payment.confirm", { key: "b", date: "2026-10-20" }),
			item("payment.confirm", { key: "c", date: null }),
			item("payment.confirm", { key: "a", date: "2026-10-20" }),
			item("payment.confirm", { key: "d", date: "2026-10-02" }),
		];
		expect(list.sort(compareItems).map((i) => i.id)).toEqual([
			"payment.confirm:d",
			"payment.confirm:a",
			"payment.confirm:b",
			"payment.confirm:c",
		]);
	});

	it("is stable: sorting twice reads the same", () => {
		const list = ids(
			["split.review", "split.review", "recurring.due"],
			["2026-10-01", "2026-10-01", null],
		);
		const once = [...list].sort(compareItems);
		expect([...once].reverse().sort(compareItems)).toEqual(once);
	});
});

describe("Needs you counts", () => {
	it("counts items per group and in total; an aggregated item counts once", () => {
		const list = [
			item("payment.confirm", { key: "p1" }),
			item("split.review", { key: "s1" }),
			item("import.review", { count: 12 }),
			item("budget.overspent", { count: 3 }),
		];
		expect(countByGroup(list)).toEqual({
			people: 2,
			activity: 1,
			budget: 1,
			setup: 0,
			total: 4,
		});
	});
});

describe("Needs you catalog", () => {
	it("covers the spec: 14 budget types, the people and activity prompts, setup", () => {
		const types = Object.keys(CATALOG) as NeedsYouType[];
		expect(types.filter((t) => t.startsWith("budget.")).length).toBe(12);
		// SPEC §5.14 lists 14: Your split was rejected and Owed for 60 days feed People.
		expect(types).toContain("split.rejected");
		expect(types).toContain("people.owedAging");
		expect(types.length).toBe(24);
	});

	it("every seam names a type the catalog knows", () => {
		for (const type of Object.keys(SEAMS)) expect(CATALOG).toHaveProperty(type);
	});

	it("no type waits for a source: Owed for 60 days and shares that need an envelope have one", () => {
		expect(SEAMS).toEqual({});
	});

	it("action ids of entities the client registry has are real registry actions", () => {
		const registry = ACTIONS as Record<string, readonly { id: string }[]>;
		for (const [type, spec] of Object.entries(CATALOG)) {
			expect(spec.actions.length, type).toBeGreaterThan(0);
			for (const action of spec.actions) {
				const defs = registry[action.entity];
				if (!defs) continue;
				expect(
					defs.map((d) => d.id),
					`${type}: ${action.entity}.${action.id}`,
				).toContain(action.id);
			}
		}
	});

	it("an item id is the type plus its key, or the type alone", () => {
		expect(item("payment.confirm", { key: "pay_1" }).id).toBe(
			"payment.confirm:pay_1",
		);
		expect(item("budget.giveJob", {}).id).toBe("budget.giveJob");
		expect(item("budget.giveJob", {}).actions[0]).toEqual({
			entity: "budget",
			id: "usePlan",
		});
	});
});
