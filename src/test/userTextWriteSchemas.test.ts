// Catches: an input that writes a user-text column without a `userText`
// schema (E2EE lane D11, PR 0 leftover). Once at-rest sealing is on, a value
// that reaches a mapped column starting with U+0001 would be stored as if it
// were a ciphertext, so every write path must refuse it at the edge.
//
// user-text-routes.test.ts proves the behavior of the fields somebody listed
// there. This one lists nothing it checks: it walks the declared input of every
// tRPC mutation and every non-GET v1 route (the zod schemas themselves, not
// the source text), finds each string property whose key is one of the column
// words of the field map (or a declared field's own name), and parses a
// control character through it. A property that takes "a<BEL>b" is not a
// `userText` schema. It is reported unless it sits in NOT_TEXT_INPUTS with a
// reason, and an entry that matches no property fails too, so the list cannot
// go stale. A new input with a column-named key therefore fails until it uses
// `userText` or is explained here.
//
// Not seen: a mapped column written from an input key that is not a column
// word (add the alias to ALIASES), a write fed by something other than a tRPC
// input or a v1 contract schema (imports and recurring posts clean their text
// with stripUserTextControls, guarded by the leading U+0001 refusal), and a
// schema built at request time.
import { contract, listContractRoutes } from "@retrospend/api-contract";
import {
	hasForbiddenControl,
	restoreText,
	USER_TEXT_FIELDS,
	userText,
} from "@retrospend/api-contract/common";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { appRouter } from "~/server/api/root";
import { mappedColumns } from "~/server/crypto/fields";

type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: unknown): Def =>
	(schema as { _zod: { def: Def } })._zod.def;

/** Zod wrappers that hold one inner schema and keep its path. */
const WRAPPERS = new Set([
	"optional",
	"nullable",
	"default",
	"prefault",
	"nonoptional",
	"readonly",
	"catch",
]);

/** The schemas directly under `schema`, other than an object's properties. */
function inner(schema: unknown): unknown[] {
	const def = defOf(schema);
	if (WRAPPERS.has(def.type)) return [def.innerType];
	switch (def.type) {
		case "pipe":
			return [def.in, def.out];
		case "union":
			return def.options as unknown[];
		case "intersection":
			return [def.left, def.right];
		case "tuple":
			return def.items as unknown[];
		case "lazy":
			return [(def.getter as () => unknown)()];
		default:
			return [];
	}
}

/** True when `schema` takes a string somewhere in its wrappers (not in a child object or array). */
function takesString(schema: unknown, seen = new Set<unknown>()): boolean {
	if (seen.has(schema)) return false;
	seen.add(schema);
	if (defOf(schema).type === "string") return true;
	return inner(schema).some((child) => takesString(child, seen));
}

type Prop = { path: string; key: string; schema: unknown };

/** Every property of every object under `root`, with its dotted path (`[]` marks an array). */
function properties(root: unknown): Prop[] {
	const out: Prop[] = [];
	const seen = new Set<unknown>();
	const walk = (schema: unknown, path: string) => {
		if (seen.has(schema)) return;
		seen.add(schema);
		const def = defOf(schema);
		if (def.type === "object") {
			for (const [key, prop] of Object.entries(
				def.shape as Record<string, unknown>,
			)) {
				const at = path ? `${path}.${key}` : key;
				out.push({ path: at, key, schema: prop });
				walk(prop, at);
			}
		} else if (def.type === "array") walk(def.element, `${path}[]`);
		else if (def.type === "record") walk(def.valueType, `${path}{}`);
		else for (const child of inner(schema)) walk(child, path);
	};
	walk(root, "");
	return out;
}

/**
 * Each shape is a leading U+0001 and an inner BEL, each paired with the same
 * text without the control. The second shape is for a column that must be a
 * URL after the text rules (`userText(...).pipe(z.url())`).
 */
const PROBES: [bad: string, clean: string][][] = [
	[
		["\u0001k1:xx", "xk1:xx"],
		["ab\u0007cd", "abxcd"],
	],
	[
		["\u0001https://a.example/x", "https://a.example/x"],
		["https://a.example/\u0007x", "https://a.example/xx"],
	],
];

const parsed = (schema: unknown, value: string) =>
	(schema as z.ZodType).safeParse(value);

/**
 * True when the property keeps a control character out of the stored value,
 * and for that reason. In some probe shape, a leading U+0001 is refused (the
 * ciphertext marker is never stripped), and an inner BEL is either refused or
 * stripped from the parsed output, while the same text without the control is
 * taken. A schema that only refuses short or oddly formatted input (`min(5)`,
 * a pattern), or takes the BEL as it is, does not pass.
 */
function refusesControls(schema: unknown) {
	return PROBES.some(([leading, inner]) => {
		const [leadBad, leadClean] = leading ?? ["", ""];
		const [innerBad, innerClean] = inner ?? ["", ""];
		if (parsed(schema, leadBad).success || !parsed(schema, leadClean).success)
			return false;
		const result = parsed(schema, innerBad);
		if (!parsed(schema, innerClean).success) return false;
		return (
			!result.success ||
			(typeof result.data === "string" && !hasForbiddenControl(result.data))
		);
	});
}

/** Keys a mapped column is written under that are not the column's own name. */
const ALIASES = ["reason", "method"];

/** The key words: mapped column names, declared field names and the aliases. */
const WORDS: ReadonlySet<string> = new Set([
	...mappedColumns().map(([, column]) => column),
	...[...USER_TEXT_FIELDS]
		.filter((field) => !field.startsWith("test."))
		.map((field) => field.slice(field.indexOf(".") + 1)),
	...ALIASES,
]);

type Input = { source: string; schema: unknown };

type TrpcProcedures = Record<
	string,
	{ _def: { type: string; inputs: unknown[] } }
>;

/** Every tRPC mutation input and every non-GET v1 route input. */
function writeInputs(): Input[] {
	const procedures = (
		appRouter as unknown as { _def: { procedures: TrpcProcedures } }
	)._def.procedures;
	const inputs: Input[] = [];
	for (const [name, procedure] of Object.entries(procedures)) {
		if (procedure._def.type !== "mutation") continue;
		for (const schema of procedure._def.inputs)
			inputs.push({ source: `trpc ${name}`, schema });
	}
	for (const route of listContractRoutes(contract)) {
		const schema = route.procedure["~orpc"].inputSchema;
		if (route.method !== "GET" && schema)
			inputs.push({ source: `v1 ${route.method} ${route.path}`, schema });
	}
	return inputs;
}

/** The text properties found, by `<source>:<path>`, split by whether they refuse controls. */
function textProperties(inputs: Input[]) {
	const checked = new Map<string, boolean>();
	for (const { source, schema } of inputs)
		for (const prop of properties(schema))
			if (WORDS.has(prop.key) && takesString(prop.schema))
				checked.set(`${source}:${prop.path}`, refusesControls(prop.schema));
	return checked;
}

const REASONS = {
	profile:
		"updateProfile strips the characters userText refuses before it writes (profile.service.ts), so Undo of an old name works",
	crash:
		"app-generated crash text, scrubbed by scrubReport, kept in error_report and feedback diagnostics, not a mapped column",
} as const;

/**
 * Column-named string inputs that are not `userText`, each with why that is
 * safe. A new entry needs a reason a reviewer accepts.
 */
const NOT_TEXT_INPUTS: Record<string, keyof typeof REASONS> = {
	"trpc profile.update:name": "profile",
	"v1 PATCH /profile:name": "profile",
	"trpc feedback.submit:diagnostics.recentErrors[].message": "crash",
	"v1 POST /feedback:diagnostics.recentErrors[].message": "crash",
	"v1 POST /error-reports:reports[].message": "crash",
};

describe("detector", () => {
	const flagged = (schema: z.ZodType) => {
		const found = textProperties([{ source: "t", schema }]);
		return [...found].filter(([, refuses]) => !refuses).map(([name]) => name);
	};

	it("flags a plain string under a column word, through any wrapper", () => {
		expect(
			flagged(
				z.object({
					title: z.string().max(10),
					notes: z.string().nullable().optional(),
					rows: z.array(z.object({ name: z.string().trim().min(1) })),
					label: z.union([z.string(), z.number()]).default("x"),
					note: z.string().transform((s) => s),
					nested: z.object({ description: z.string() }),
				}),
			),
		).toEqual([
			"t:title",
			"t:notes",
			"t:rows[].name",
			"t:label",
			"t:note",
			"t:nested.description",
		]);
	});

	it("does not take a schema that refuses controls only by length or format", () => {
		expect(
			flagged(
				z.object({
					title: z.string().min(5).max(10),
					name: z.string().min(6),
					note: z.string().regex(/^[a-z]+$/),
					websiteUrl: z.url(),
				}),
			),
		).toEqual(["t:title", "t:name", "t:note", "t:websiteUrl"]);
	});

	it("needs the marker refused even when the schema strips the rest", () => {
		expect(
			flagged(
				z.object({
					title: z.string().transform((s) => s.replaceAll("\u0007", "")),
					note: z.string().transform((s) => s.trim()),
				}),
			),
		).toEqual(["t:title", "t:note"]);
		expect(
			flagged(
				z.object({
					title: restoreText(10),
					note: restoreText(10, { empty: true }).nullable(),
				}),
			),
		).toEqual([]);
	});

	it("passes userText and restoreText through wrappers and pipes, and ignores other keys", () => {
		expect(
			flagged(
				z.object({
					restored: restoreText(10),
					description: restoreText(10, { empty: true }).nullish(),
					title: userText("test.detector", 10),
					notes: userText("test.detector", 10).nullable().optional(),
					rows: z.array(
						z.object({ name: z.string().trim().pipe(userText("test.d", 10)) }),
					),
					websiteUrl: userText("test.detector", 100).pipe(z.url()).optional(),
					other: z.string(),
					kind: z.enum(["name"]),
					name: z.number(),
				}),
			),
		).toEqual([]);
	});

	it("walks the real inputs and sees the fields it should", () => {
		const found = textProperties(writeInputs());
		const refusing = [...found].filter(([, refuses]) => refuses);
		expect(refusing.length).toBeGreaterThan(60);
		for (const name of [
			"trpc expense.createExpense:title",
			"trpc sharedTransaction.update:notes",
			"trpc people.createShadow:name",
			"trpc settlement.reject:reason",
			"trpc paymentMethod.upsert:methods[].identifier",
		])
			expect(found.get(name), name).toBe(true);
	});
});

describe("write inputs for mapped columns", () => {
	const found = textProperties(writeInputs());
	const notUserText = [...found]
		.filter(([, refuses]) => !refuses)
		.map(([name]) => name);

	it("use userText, or are explained", () => {
		expect(notUserText.filter((name) => !(name in NOT_TEXT_INPUTS))).toEqual(
			[],
		);
	});

	it("keep no explanation for an input that is gone or fixed", () => {
		expect(
			Object.keys(NOT_TEXT_INPUTS).filter((name) => !notUserText.includes(name)),
		).toEqual([]);
	});
});
