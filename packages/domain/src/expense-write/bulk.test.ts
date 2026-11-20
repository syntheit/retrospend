import { describe, expect, it } from "vitest";
import {
	categorize,
	deleteMany,
	type ExpenseBulkPort,
	NOTHING_TO_DELETE,
	skipReason,
} from "./bulk";
import type { CategoryFacts } from "./category";
import type { StoredExpense } from "./edit";
import { arsRow } from "./fake-port";
import { CategoryNotFoundError, EditRefusal } from "./refusals";

const food: CategoryFacts = {
	id: "c-food",
	kind: "EXPENSE",
	excludeByDefault: false,
};
const hold: CategoryFacts = {
	id: "c-hold",
	kind: "EXPENSE",
	excludeByDefault: true,
};
const old: CategoryFacts = {
	id: "c-old",
	kind: "EXPENSE",
	excludeByDefault: false,
};
const income: CategoryFacts = {
	id: "c-inc",
	kind: "INCOME",
	excludeByDefault: false,
};

/** Each row is the ARS fixture (USD 100 at blue 1545) under its own id. */
const row = (id: string, over: Partial<StoredExpense> = {}): StoredExpense => ({
	...arsRow,
	id,
	...over,
});

/** An in-memory port: writes change the rows, so a later read sees them; every call is logged. */
function memoryPort(
	rows: StoredExpense[],
	categories: CategoryFacts[] = [food, hold, income, old],
) {
	const stored = new Map(rows.map((r) => [r.id, r]));
	const log: string[] = [];
	const port: ExpenseBulkPort = {
		rows: async (ids) => {
			log.push(`rows ${ids.join(",")}`);
			return ids.flatMap((id) => stored.get(id) ?? []);
		},
		category: async (id) => {
			log.push(`category ${id}`);
			return categories.find((c) => c.id === id) ?? null;
		},
		setCategory: async (list, categoryId, excluded) => {
			log.push(
				`set ${list.map((r) => r.id).join(",")} ${categoryId} ${excluded}`,
			);
			for (const r of list)
				stored.set(r.id, {
					...r,
					categoryId,
					excludeFromAnalytics: excluded ?? r.excludeFromAnalytics,
				});
		},
		remove: async (r) => {
			log.push(`remove ${r.id}`);
			stored.delete(r.id);
			for (const part of [...stored.values()])
				if (r.isAmortizedParent && part.isAmortizedChild)
					stored.delete(part.id);
		},
	};
	return { port, log, stored };
}

const plain = row("a");
const fee = row("fee", { hasLegs: true });
const salary = row("salary", { direction: "IN" });
const part = row("part", { isAmortizedChild: true });
const parent = row("parent", { isAmortizedParent: true });

describe("skipReason", () => {
	it("takes an outgoing row and says why it leaves the rest", () => {
		expect(skipReason(plain, "delete")).toBeNull();
		expect(skipReason(plain, "categorize")).toBeNull();
		expect(skipReason(undefined, "delete")).toBe("notFound");
		expect(skipReason(salary, "delete")).toBe("notFound");
		expect(skipReason(part, "categorize")).toBe("notFound");
		expect(skipReason(fee, "delete")).toBe("hasLegs");
		expect(skipReason(fee, "categorize")).toBe("hasLegs");
	});

	it("a spread parent goes with a delete and stays out of a categorize", () => {
		expect(skipReason(parent, "delete")).toBeNull();
		expect(skipReason(parent, "categorize")).toBe("spread");
	});
});

describe("deleteMany", () => {
	it("deletes each id once, in order, and names the skipped ids with their reasons", async () => {
		const p = memoryPort([plain, row("b"), fee, salary, part]);
		const out = await deleteMany(p.port, [
			"b",
			"fee",
			"a",
			"ghost",
			"salary",
			"part",
			"a",
		]);
		expect(out.deleted).toEqual(["b", "a"]);
		expect(out.skipped).toEqual([
			{ id: "fee", reason: "hasLegs" },
			{ id: "ghost", reason: "notFound" },
			{ id: "salary", reason: "notFound" },
			{ id: "part", reason: "notFound" },
		]);
		expect([...p.stored.keys()]).toEqual(["fee", "salary", "part"]);
	});

	it("the hook runs for each row that goes, before it goes, and never for a skipped one", async () => {
		const p = memoryPort([plain, fee]);
		const seen: string[] = [];
		await deleteMany(p.port, ["fee", "a"], {
			beforeRemove: async (r) =>
				void seen.push(`${r.id}:${p.stored.has(r.id)}`),
		});
		expect(seen).toEqual(["a:true"]);
	});

	it("a spread parent goes through the adapter, which takes its parts", async () => {
		const p = memoryPort([parent, part]);
		expect((await deleteMany(p.port, ["parent"])).deleted).toEqual(["parent"]);
		expect(p.stored.size).toBe(0);
	});

	it("refuses when nothing can go, and the refusal is a bad request", async () => {
		const p = memoryPort([fee, salary]);
		const error = await deleteMany(p.port, ["fee", "salary", "ghost"]).catch(
			(e) => e,
		);
		expect(error).toBeInstanceOf(EditRefusal);
		expect(error).toMatchObject({
			kind: "badRequest",
			message: NOTHING_TO_DELETE,
		});
		expect(p.log.filter((l) => l.startsWith("remove"))).toEqual([]);
	});
});

describe("categorize", () => {
	it("moves the rows it reaches, counts them and names the rest", async () => {
		const p = memoryPort([plain, row("b"), fee, salary, part, parent]);
		const out = await categorize(p.port, [
			{
				categoryId: "c-food",
				ids: ["a", "b", "fee", "salary", "part", "parent", "ghost"],
			},
		]);
		expect(out.updated).toBe(2);
		expect(out.skipped).toEqual([
			{ id: "fee", reason: "hasLegs" },
			{ id: "salary", reason: "notFound" },
			{ id: "part", reason: "notFound" },
			{ id: "parent", reason: "spread" },
			{ id: "ghost", reason: "notFound" },
		]);
		expect(p.stored.get("a")?.categoryId).toBe("c-food");
		for (const id of ["fee", "salary", "part", "parent"])
			expect(p.stored.get(id)?.categoryId, id).toBe("c-old");
	});

	it("checks the category before it reads any row", async () => {
		for (const id of ["c-inc", "nope"]) {
			const p = memoryPort([plain]);
			const error = await categorize(p.port, [
				{ categoryId: id, ids: ["a", "ghost"] },
			]).catch((e) => e);
			expect(error).toBeInstanceOf(CategoryNotFoundError);
			// Categorize answers a bad category with v1's 403.
			expect((error as CategoryNotFoundError).v1Code).toBe("forbidden");
			expect(p.log).toEqual([`category ${id}`]);
		}
	});

	it("lenient: a gone or income category leaves the rows uncategorized", async () => {
		for (const id of ["c-inc", "nope"]) {
			const p = memoryPort([plain]);
			const out = await categorize(p.port, [{ categoryId: id, ids: ["a"] }], {
				lenient: true,
			});
			expect(out.updated).toBe(1);
			expect(p.stored.get("a")?.categoryId).toBeNull();
		}
	});

	it("a category held out by default excludes the rows it takes, as an edit does", async () => {
		const p = memoryPort([plain]);
		await categorize(p.port, [{ categoryId: "c-hold", ids: ["a"] }]);
		expect(p.stored.get("a")).toMatchObject({
			categoryId: "c-hold",
			excludeFromAnalytics: true,
		});
	});

	it("a row already in the category keeps its flag; a category with no default leaves the flag alone", async () => {
		const p = memoryPort([
			row("in", { categoryId: "c-hold", excludeFromAnalytics: false }),
			row("out", { categoryId: "c-old", excludeFromAnalytics: true }),
		]);
		const first = await categorize(p.port, [
			{ categoryId: "c-hold", ids: ["in"] },
		]);
		expect(first.updated).toBe(1);
		expect(p.stored.get("in")?.excludeFromAnalytics).toBe(false);
		expect(p.log.some((l) => l.startsWith("set"))).toBe(false);
		await categorize(p.port, [{ categoryId: "c-food", ids: ["out"] }]);
		expect(p.stored.get("out")).toMatchObject({
			categoryId: "c-food",
			excludeFromAnalytics: true,
		});
	});

	it("previous says where each row was with its flag, and moving back restores both", async () => {
		const p = memoryPort([
			row("x", { categoryId: "c-old", excludeFromAnalytics: false }),
			row("y", { categoryId: "c-old", excludeFromAnalytics: true }),
			row("z", { categoryId: null, excludeFromAnalytics: false }),
		]);
		const out = await categorize(p.port, [
			{ categoryId: "c-hold", ids: ["x", "y", "z"] },
		]);
		expect(out.previous).toEqual([
			{ categoryId: "c-old", ids: ["x"], excluded: false },
			{ categoryId: "c-old", ids: ["y"], excluded: true },
			{ categoryId: null, ids: ["z"], excluded: false },
		]);
		expect(
			["x", "y", "z"].map((id) => p.stored.get(id)?.excludeFromAnalytics),
		).toEqual([true, true, true]);
		// The undo is the same mutation over `previous`, lenient.
		const back = await categorize(p.port, out.previous, { lenient: true });
		expect(back.updated).toBe(3);
		expect(
			["x", "y", "z"].map((id) => [
				p.stored.get(id)?.categoryId,
				p.stored.get(id)?.excludeFromAnalytics,
			]),
		).toEqual([
			["c-old", false],
			["c-old", true],
			[null, false],
		]);
	});

	it("an undo into a category held out by default puts the old flag back, not the default", async () => {
		const p = memoryPort([
			row("x", { categoryId: "c-hold", excludeFromAnalytics: false }),
		]);
		await categorize(p.port, [{ categoryId: "c-food", ids: ["x"] }]);
		await categorize(p.port, [
			{ categoryId: "c-hold", ids: ["x"], excluded: false },
		]);
		expect(p.stored.get("x")).toMatchObject({
			categoryId: "c-hold",
			excludeFromAnalytics: false,
		});
	});

	it("an undo whose category is gone drops it and still restores the flag", async () => {
		const p = memoryPort(
			[row("x", { categoryId: "c-food", excludeFromAnalytics: true })],
			[hold],
		);
		await categorize(
			p.port,
			[{ categoryId: "c-gone", ids: ["x"], excluded: false }],
			{ lenient: true },
		);
		expect(p.stored.get("x")).toMatchObject({
			categoryId: null,
			excludeFromAnalytics: false,
		});
	});

	it("an id twice in a move counts once", async () => {
		const p = memoryPort([plain]);
		expect(
			(await categorize(p.port, [{ categoryId: "c-food", ids: ["a", "a"] }]))
				.updated,
		).toBe(1);
	});
});
