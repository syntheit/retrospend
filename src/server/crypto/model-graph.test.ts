// Catches: the field-open walk following the wrong relations because the
// Prisma runtime data model (a private member, read in db-core.ts) moved or
// changed shape in an upgrade. The graph built from it must name exactly the
// relations prisma/schema.prisma declares.
import { describe, expect, it, vi } from "vitest";
import { runtimeDataModel } from "~/server/db-core";

// db-core builds the real client at load; it never connects here.
vi.mock("~/env", () => ({
	env: { DATABASE_URL: "postgresql://unused@127.0.0.1:1/unused", NODE_ENV: "test" },
}));
import { readSchema } from "~/test/prisma-schema";
import { fieldsOfModel } from "./fields";
import { buildModelGraph } from "./model-graph";

const schema = readSchema();
const modelNames = new Set(schema.map((m) => m.name));
const graph = buildModelGraph(runtimeDataModel());

describe("the model graph", () => {
	it("has every schema model and exactly its relation fields", () => {
		for (const model of schema) {
			const expected = Object.fromEntries(
				model.fields
					.filter((f) => modelNames.has(f.type))
					.map((f) => [f.name, f.type]),
			);
			expect(
				Object.fromEntries(graph.relations(model.name)),
				model.name,
			).toEqual(expected);
		}
		expect(Object.keys(runtimeDataModel().models).sort()).toEqual(
			[...modelNames].sort(),
		);
	});

	it("marks models that reach a mapped cell through a relation", () => {
		// Neither holds text; each reaches a mapped model through one link.
		expect(fieldsOfModel("AnalyticsCategoryPreference")).toBeUndefined();
		expect(graph.reaches("AnalyticsCategoryPreference")).toBe(true);
		expect(graph.reaches("PushDelivery")).toBe(true);
		expect(graph.reaches("Expense")).toBe(true);
	});

	it("leaves out models with no path to a mapped cell", () => {
		const isolated = schema.filter(
			(m) =>
				fieldsOfModel(m.name) === undefined &&
				!m.fields.some((f) => modelNames.has(f.type)),
		);
		expect(isolated.length).toBeGreaterThan(0);
		for (const model of isolated)
			expect(graph.reaches(model.name), model.name).toBe(false);
		expect(graph.reaches("NoSuchModel")).toBe(false);
	});

	it("refuses an empty data model, so a moved internal fails loudly", () => {
		expect(() => buildModelGraph({ models: {} })).toThrow();
	});
});
