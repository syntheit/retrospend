/**
 * The OpenAPI document (packages/api-contract/openapi.json) as the API
 * reference needs it: operations grouped by tag, and schemas flattened to
 * the rows of a table. Plain data in, plain data out, so the pages stay thin
 * and this stays testable.
 */

type Json = Record<string, unknown>;

export type OpenApiDocument = {
	info: { title: string; version: string; description?: string };
	paths: Record<string, Record<string, Json>>;
	components?: { schemas?: Record<string, Json> };
};

/** One field of a request or response body, or one parameter. */
export type FieldRow = {
	/** Dotted path: `items[].name`. */
	path: string;
	type: string;
	required: boolean;
	description: string;
};

export type ParamRow = FieldRow & { where: "path" | "query" | "header" };

export type Operation = {
	id: string;
	method: string;
	path: string;
	summary: string;
	description: string;
	scope: string | null;
	event: string | null;
	tag: string;
	params: ParamRow[];
	request: FieldRow[] | null;
	responseStatus: string | null;
	response: FieldRow[] | null;
	/** Fields that were left out of the tables to keep them short. */
	hidden: number;
};

export type Group = { tag: string; slug: string; operations: Operation[] };

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const MAX_DEPTH = 3;
export const MAX_ROWS = 60;

export function slugOf(tag: string): string {
	return tag
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function resolve(doc: OpenApiDocument, schema: unknown): Json {
	if (!isObject(schema)) return {};
	const ref = schema.$ref;
	if (typeof ref === "string") {
		const name = ref.replace("#/components/schemas/", "");
		return resolve(doc, doc.components?.schemas?.[name]);
	}
	return schema;
}

function nonNull(list: unknown): Json[] {
	return (Array.isArray(list) ? list : []).filter(
		(s): s is Json => isObject(s) && s.type !== "null",
	);
}

/** A short type label: `string`, `string (date-time)`, `"a" | "b"`, `object[]`. */
export function typeLabel(doc: OpenApiDocument, input: unknown): string {
	const schema = resolve(doc, input);
	const union = schema.anyOf ?? schema.oneOf;
	const variants = nonNull(union);
	if (variants.length > 0) {
		const nullable = (union as Json[]).some((s) => s.type === "null");
		const labels = [...new Set(variants.map((v) => typeLabel(doc, v)))];
		return [...labels, ...(nullable ? ["null"] : [])].join(" | ");
	}
	if (Array.isArray(schema.enum)) {
		const shown = schema.enum.slice(0, 6).map((v) => JSON.stringify(v));
		return shown.join(" | ") + (schema.enum.length > 6 ? " | …" : "");
	}
	if ("const" in schema) return JSON.stringify(schema.const);
	if (schema.type === "array") return `${typeLabel(doc, schema.items)}[]`;
	const type = typeof schema.type === "string" ? schema.type : "object";
	return typeof schema.format === "string" ? `${type} (${schema.format})` : type;
}

function describeSchema(schema: Json): string {
	const text = typeof schema.description === "string" ? schema.description : "";
	const dflt =
		"default" in schema && schema.default !== undefined
			? `Default: ${JSON.stringify(schema.default)}.`
			: "";
	return [text, dflt].filter(Boolean).join(" ");
}

type Collector = { rows: FieldRow[]; hidden: number };

function push(into: Collector, row: FieldRow) {
	if (into.rows.length >= MAX_ROWS) into.hidden += 1;
	else into.rows.push(row);
}

function walk(
	doc: OpenApiDocument,
	input: unknown,
	prefix: string,
	depth: number,
	into: Collector,
) {
	const schema = resolve(doc, input);
	const variants = nonNull(schema.anyOf ?? schema.oneOf);
	// A nullable object is the object; a real union is shown by its label only.
	const target = variants.length === 1 ? resolve(doc, variants[0]) : schema;
	const itemSchema =
		target.type === "array" ? resolve(doc, target.items) : null;
	const objectOf = itemSchema?.type === "object" ? itemSchema : target;
	const props = objectOf.properties;
	if (!isObject(props) || depth >= MAX_DEPTH) return;
	const required = new Set(
		Array.isArray(objectOf.required) ? (objectOf.required as string[]) : [],
	);
	const base = itemSchema ? `${prefix}[]` : prefix;
	for (const [name, child] of Object.entries(props)) {
		const path = base ? `${base}.${name}` : name;
		const resolved = resolve(doc, child);
		push(into, {
			path,
			type: typeLabel(doc, child),
			required: required.has(name),
			description: describeSchema(resolved),
		});
		walk(doc, child, path, depth + 1, into);
	}
}

/** The fields of a body schema as table rows, nested fields as dotted paths. */
export function flattenSchema(
	doc: OpenApiDocument,
	schema: unknown,
): { rows: FieldRow[]; hidden: number } {
	const into: Collector = { rows: [], hidden: 0 };
	walk(doc, schema, "", 0, into);
	return into;
}

function bodySchema(content: unknown): unknown {
	if (!isObject(content)) return undefined;
	const media = content["application/json"] ?? Object.values(content)[0];
	return isObject(media) ? media.schema : undefined;
}

function paramsOf(doc: OpenApiDocument, op: Json): ParamRow[] {
	const list = Array.isArray(op.parameters) ? (op.parameters as Json[]) : [];
	return list
		.filter(
			// The idempotency header is explained once on the overview page.
			(p) => p.name !== "Idempotency-Key",
		)
		.map((p) => ({
			where: p.in as ParamRow["where"],
			path: String(p.name),
			type: typeLabel(doc, p.schema),
			required: p.required === true,
			description: describeSchema(resolve(doc, p.schema)),
		}));
}

function buildOperation(
	doc: OpenApiDocument,
	path: string,
	method: string,
	op: Json,
): Operation {
	const tags = Array.isArray(op.tags) ? (op.tags as string[]) : [];
	const body = isObject(op.requestBody) ? bodySchema(op.requestBody.content) : undefined;
	const responses = isObject(op.responses) ? op.responses : {};
	const status = Object.keys(responses).find((s) => s.startsWith("2")) ?? null;
	const ok = status && isObject(responses[status]) ? responses[status] : null;
	const request = body ? flattenSchema(doc, body) : null;
	const response = ok ? flattenSchema(doc, bodySchema(ok.content)) : null;
	return {
		id: String(op.operationId ?? `${method}${path}`),
		method: method.toUpperCase(),
		path,
		summary: String(op.summary ?? ""),
		description: String(op.description ?? ""),
		scope: typeof op["x-required-scope"] === "string" ? op["x-required-scope"] : null,
		event: typeof op["x-event-type"] === "string" ? op["x-event-type"] : null,
		tag: tags[0] ?? "Other",
		params: paramsOf(doc, op),
		request: request?.rows ?? null,
		responseStatus: status,
		response: response?.rows ?? null,
		hidden: (request?.hidden ?? 0) + (response?.hidden ?? 0),
	};
}

/** Operations grouped by their first tag, groups and routes in document order. */
export function groupsOf(doc: OpenApiDocument): Group[] {
	const by = new Map<string, Operation[]>();
	for (const [path, item] of Object.entries(doc.paths)) {
		for (const method of METHODS) {
			const op = item[method];
			if (!op) continue;
			const built = buildOperation(doc, path, method, op);
			by.set(built.tag, [...(by.get(built.tag) ?? []), built]);
		}
	}
	return [...by.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([tag, operations]) => ({ tag, slug: slugOf(tag), operations }));
}
