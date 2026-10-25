import { budgetSchemas } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import * as core from "~/lib/schemas/envelope";
import * as book from "~/lib/schemas/envelope-book";
import * as crud from "~/lib/schemas/envelope-crud";
import * as debt from "~/lib/schemas/envelope-debt";
import * as migration from "~/lib/schemas/envelope-migration";
import * as plan from "~/lib/schemas/envelope-plan";

/**
 * The contract package cannot import the app, so it carries its own copy of
 * the budget schemas (packages/api-contract/src/budget). This keeps the two
 * equal, schema by schema, in both directions of the JSON they describe: a
 * change to the web's contract that is not made here fails the build.
 */

const sources: Record<string, unknown> = {
	...core,
	...book,
	...crud,
	...debt,
	...migration,
	...plan,
};
const mirrors = budgetSchemas as unknown as Record<string, unknown>;

type Json = Record<string, unknown>;

/** Follows $ref so a schema with an id compares to the same one written inline. */
function resolve(node: unknown, defs: Json): unknown {
	if (Array.isArray(node)) return node.map((n) => resolve(n, defs));
	if (node === null || typeof node !== "object") return node;
	const obj = node as Json;
	if (typeof obj.$ref === "string") {
		const name = obj.$ref.split("/").pop() as string;
		return resolve(defs[name], defs);
	}
	return Object.fromEntries(
		Object.entries(obj)
			.filter(([k]) => k !== "$defs" && k !== "$schema" && k !== "id")
			.map(([k, v]) => [k, resolve(v, defs)]),
	);
}

const isMoney = (o: Json) => {
	const p = o.properties as Json | undefined;
	return p && Object.keys(p).sort().join() === "currency,minor";
};

/**
 * What may differ on purpose: money is the shared Money schema (its currency
 * has a stricter pattern), and a Date in the web's schema is an ISO instant on
 * the wire.
 */
function canon(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(canon);
	if (node === null || typeof node !== "object") return node;
	const obj = node as Json;
	if (obj.format === "date-time") return {};
	if (isMoney(obj)) return "money";
	return Object.fromEntries(
		Object.entries(obj)
			.filter(([k]) => k !== "description" && k !== "examples")
			.map(([k, v]) => [k, canon(v)]),
	);
}

function jsonOf(schema: z.ZodType, io: "input" | "output") {
	const full = z.toJSONSchema(schema, {
		io,
		unrepresentable: "any",
		reused: "inline",
	}) as Json;
	return canon(resolve(full, (full.$defs as Json) ?? {}));
}

const names = Object.keys(sources).filter(
	(k) => sources[k] instanceof z.ZodType,
);

describe("budget contract mirrors the web's schemas", () => {
	it("mirrors every schema the web declares", () => {
		const missing = names.filter((n) => !(n in mirrors));
		// The shared Money schema stands for the web's own.
		expect(missing).toEqual(["moneySchema"]);
	});

	it("sees a difference when there is one", () => {
		const a = jsonOf(mirrors.assignInputSchema as z.ZodType, "input");
		const b = jsonOf(sources.moveInputSchema as z.ZodType, "input");
		expect(a).not.toEqual(b);
		const loose = z.object({
			...(sources.moveInputSchema as z.ZodObject).shape,
			kind: z.string(),
		});
		expect(jsonOf(loose, "input")).not.toEqual(
			jsonOf(sources.moveInputSchema as z.ZodType, "input"),
		);
	});

	it.each(names.filter((n) => n in mirrors))("%s: input", (name) => {
		expect(jsonOf(mirrors[name] as z.ZodType, "input")).toEqual(
			jsonOf(sources[name] as z.ZodType, "input"),
		);
	});

	it.each(names.filter((n) => n in mirrors))("%s: output", (name) => {
		expect(jsonOf(mirrors[name] as z.ZodType, "output")).toEqual(
			jsonOf(sources[name] as z.ZodType, "output"),
		);
	});
});
