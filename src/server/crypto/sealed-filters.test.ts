import { describe, expect, it } from "vitest";
import { buildModelGraph } from "./model-graph";
import { filtersOnSealed } from "./sealed-filters";

const scalar = (name: string) => ({ name, kind: "scalar", type: "String" });
const relation = (name: string, type: string) => ({
	name,
	kind: "object",
	type,
});
// Expense.title and Category.name are mapped (fields.ts); the rest are not.
const graph = buildModelGraph({
	models: {
		Expense: {
			fields: [
				scalar("id"),
				scalar("userId"),
				scalar("title"),
				scalar("amount"),
				scalar("date"),
				relation("category", "Category"),
			],
		},
		Category: {
			fields: [
				scalar("id"),
				scalar("userId"),
				scalar("name"),
				relation("expenses", "Expense"),
			],
		},
		Notification: { fields: [scalar("id"), scalar("data")] },
		IdempotencyKey: {
			fields: [scalar("id"), scalar("key"), scalar("responseBody")],
		},
	},
});

const refused = (model: string, args: unknown) =>
	filtersOnSealed(graph, model, args);

describe("filtersOnSealed", () => {
	it.each([
		["a where", { where: { title: "Rent" } }],
		["a filter operator", { where: { title: { contains: "re" } } }],
		["a null test", { where: { title: null } }],
		[
			"AND, OR and NOT",
			{ where: { AND: [{ OR: [{ NOT: { title: "x" } }] }] } },
		],
		["a to-one relation filter", { where: { category: { name: "Food" } } }],
		["is", { where: { category: { is: { name: "Food" } } } }],
		["an orderBy", { orderBy: { title: "asc" } }],
		["an orderBy list", { orderBy: [{ date: "desc" }, { title: "asc" }] }],
		[
			"an orderBy through a relation",
			{ orderBy: { category: { name: "asc" } } },
		],
		["a distinct", { distinct: ["title"] }],
		["a distinct string", { distinct: "title" }],
		["a groupBy by", { by: ["title"] }],
		["a having", { by: ["date"], having: { title: { _count: { gt: 1 } } } }],
		[
			"an orderBy on a count",
			{ by: ["date"], orderBy: { _count: { title: "desc" } } },
		],
		["a _min", { _min: { title: true } }],
		["a _max", { _max: { title: true } }],
		["a cursor", { cursor: { title: "x" } }],
		[
			"a nested include filter",
			{
				include: {
					category: { include: { expenses: { where: { title: "x" } } } },
				},
			},
		],
		[
			"a nested select sort",
			{
				select: {
					category: { select: { expenses: { orderBy: { title: "asc" } } } },
				},
			},
		],
		[
			"a filtered relation count",
			{
				select: {
					category: {
						select: {
							_count: { select: { expenses: { where: { title: "x" } } } },
						},
					},
				},
			},
		],
	])("refuses %s on Expense", (_label, args) => {
		expect(refused("Expense", args)).toBe(true);
	});

	it.each([
		["a some filter", { where: { expenses: { some: { title: "Rent" } } } }],
		[
			"a compound unique key",
			{ where: { name_userId: { name: "Food", userId: "u" } } },
		],
		[
			"an upsert by compound unique key",
			{
				where: { name_userId: { name: "Food", userId: "u" } },
				create: {},
				update: {},
			},
		],
		[
			"a nested updateMany",
			{
				where: { id: "c" },
				data: {
					expenses: {
						updateMany: { where: { title: "x" }, data: { amount: 1 } },
					},
				},
			},
		],
		[
			"a nested deleteMany",
			{
				where: { id: "c" },
				data: { expenses: { deleteMany: { title: "x" } } },
			},
		],
		[
			"a nested set",
			{ where: { id: "c" }, data: { expenses: { set: [{ title: "x" }] } } },
		],
	])("refuses %s on Category", (_label, args) => {
		expect(refused("Category", args)).toBe(true);
	});

	it("refuses a connect, deep in a nested create, by a mapped unique key", () => {
		expect(
			refused("Expense", {
				data: {
					title: "Rent",
					category: {
						connectOrCreate: {
							where: { name_userId: { name: "Food", userId: "u" } },
							create: { name: "Food" },
						},
					},
				},
			}),
		).toBe(true);
	});

	it.each([
		["no args", undefined],
		[
			"plain filters and sorts",
			{
				where: { userId: "u", amount: { gt: 1 } },
				orderBy: [{ date: "desc" }, { id: "desc" }],
			},
		],
		[
			"writing text and connecting by id",
			{ data: { title: "Rent", category: { connect: { id: "c" } } } },
		],
		[
			"writing text in a nested create",
			{
				data: {
					title: "Rent",
					category: { create: { name: "Food", userId: "u" } },
				},
			},
		],
		[
			"selecting text",
			{ select: { title: true, category: { select: { name: true } } } },
		],
		["counting text", { _count: { title: true } }],
		["an undefined filter value", { where: { title: undefined } }],
	])("lets %s through", (_label, args) => {
		expect(refused("Expense", args)).toBe(false);
	});

	it("never reads a JSON value as arguments", () => {
		expect(
			refused("Notification", { data: { data: { where: { title: "x" } } } }),
		).toBe(false);
	});
});

describe("filters on a JSON body cell", () => {
	it("refuses any filter, sort or pick of the body and allows its row's other columns", () => {
		for (const args of [
			{ where: { responseBody: { path: ["name"], equals: "x" } } },
			{ where: { responseBody: { equals: {} } } },
			{ orderBy: { responseBody: "asc" } },
			{ distinct: ["responseBody"] },
		])
			expect(refused("IdempotencyKey", args)).toBe(true);
		expect(
			refused("IdempotencyKey", {
				where: { key: { startsWith: "undo-icon:" } },
				select: { responseBody: true },
			}),
		).toBe(false);
	});
});
