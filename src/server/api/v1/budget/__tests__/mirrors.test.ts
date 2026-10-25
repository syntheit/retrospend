import { budgetSchemas } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import * as core from "~/lib/schemas/envelope";
import * as book from "~/lib/schemas/envelope-book";
import * as crud from "~/lib/schemas/envelope-crud";
import * as debt from "~/lib/schemas/envelope-debt";
import * as migration from "~/lib/schemas/envelope-migration";
import * as plan from "~/lib/schemas/envelope-plan";
import * as usePlan from "~/lib/schemas/envelope-use-plan";

/**
 * The contract package cannot import the app, so it carries its own copy of
 * the budget schemas (packages/api-contract/src/budget). This keeps the two
 * equal, schema by schema, in the JSON they describe: a change to the web's
 * contract that is not made here fails the build.
 *
 * What differs on purpose, and is made equal before comparing:
 * - Money is the shared Money schema (a stricter currency pattern).
 * - A Date in the web's schema is an ISO instant on the wire.
 * - v1 takes money as decimal text: the web's `<name>Minor` integer is
 *   `<name>` text in v1 (src/server/services/api-v1/budget/amounts.ts).
 * - A draft answers its rows' amounts as Money (see DRAFT_OUTPUTS).
 */

const sources: Record<string, unknown> = {
	...core,
	...book,
	...crud,
	...debt,
	...migration,
	...plan,
	...usePlan,
};
const mirrors = budgetSchemas as unknown as Record<string, unknown>;

/** Schemas whose answer differs from the web's: rows with an amount are Money in v1. */
const DRAFT_OUTPUTS = new Set([
	"draftSchema",
	"draftsOutputSchema",
	"draftResultSchema",
	"planFillOutputSchema",
]);

const AMOUNT_BASES = new Set([
	"amount",
	"startingMoney",
	"haveNow",
	"bank",
	"extraMonthly",
	"minimum",
	"principal",
	"interest",
	"monthly",
]);

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

/** Whatever is written for an amount: the web's integer, v1's decimal text. */
function amountLeaf(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(amountLeaf);
	if (node === null || typeof node !== "object") return node;
	const obj = node as Json;
	const text =
		obj.type === "string" &&
		typeof obj.pattern === "string" &&
		obj.pattern.includes("\\d{1,11}");
	if (obj.type === "integer" || obj.type === "number" || text) return "amount";
	return Object.fromEntries(
		Object.entries(obj).map(([k, v]) => [k, amountLeaf(v)]),
	);
}

/** A property that carries an amount: the web's \`<name>Minor\` integer, or v1's text. */
function amountProperty(key: string, value: unknown): string | null {
	if (key.endsWith("Minor") && AMOUNT_BASES.has(key.slice(0, -5)))
		return key.slice(0, -5);
	if (AMOUNT_BASES.has(key) && JSON.stringify(value).includes("\\d{1,11}"))
		return key;
	return null;
}

function canon(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(canon);
	if (node === null || typeof node !== "object") return node;
	const obj = node as Json;
	if (obj.format === "date-time") return {};
	if (isMoney(obj)) return "money";
	const out: Json = {};
	for (const [k, v] of Object.entries(obj)) {
		if (k === "description" || k === "examples") continue;
		if (k === "properties" && v && typeof v === "object") {
			out[k] = Object.fromEntries(
				Object.entries(v as Json).map(([pk, pv]) => {
					const base = amountProperty(pk, pv);
					return base ? [base, amountLeaf(pv)] : [pk, canon(pv)];
				}),
			);
		} else if (k === "required" && Array.isArray(v)) {
			out[k] = v
				.map((r) =>
					AMOUNT_BASES.has(String(r).replace(/Minor$/, ""))
						? String(r).replace(/Minor$/, "")
						: r,
				)
				.sort();
		} else out[k] = canon(v);
	}
	return out;
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

	it("takes money in as decimal text, never as a JSON number", () => {
		for (const name of names.filter((n) => n in mirrors)) {
			const text = JSON.stringify(
				z.toJSONSchema(mirrors[name] as z.ZodType, {
					io: "input",
					unrepresentable: "any",
				}),
			);
			expect(text, name).not.toMatch(/"[a-zA-Z]+Minor"/);
		}
	});

	it.each(names.filter((n) => n in mirrors && !DRAFT_OUTPUTS.has(n)))(
		"%s: input",
		(name) => {
			expect(jsonOf(mirrors[name] as z.ZodType, "input")).toEqual(
				jsonOf(sources[name] as z.ZodType, "input"),
			);
		},
	);

	it.each(names.filter((n) => n in mirrors && !DRAFT_OUTPUTS.has(n)))(
		"%s: output",
		(name) => {
			expect(jsonOf(mirrors[name] as z.ZodType, "output")).toEqual(
				jsonOf(sources[name] as z.ZodType, "output"),
			);
		},
	);
});
