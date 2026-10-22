import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { PROBLEM_CONTENT_TYPE, problemSchema } from "./common/errors";
import {
	API_PREFIX,
	type ContractEntry,
	listContractRoutes,
} from "./common/meta";
import { moneySchema } from "./common/money";
import { contract } from "./index";

type JsonObject = Record<string, unknown>;

/**
 * The contract's own version (info.version). Bump the minor for additive
 * changes and the patch for docs only; a breaking change needs /api/v2.
 */
export const CONTRACT_VERSION = "1.0.0";

const PROBLEM_REF = { $ref: "#/components/schemas/Problem" };

const SECURITY_SCHEMES = {
	bearerAuth: {
		type: "http",
		scheme: "bearer",
		description:
			"A session token from sign-in or device authorization, or an API key.",
	},
	apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
	cookieAuth: {
		type: "apiKey",
		in: "cookie",
		name: "better-auth.session_token",
	},
};

function problemResponse(description: string) {
	return {
		description,
		content: { [PROBLEM_CONTENT_TYPE]: { schema: PROBLEM_REF } },
	};
}

/**
 * Error responses every operation can return, all as problem+json. They
 * replace the generator's own error bodies, which use oRPC's shape.
 */
function errorResponses(entry: ContractEntry): JsonObject {
	const base: JsonObject = {
		"400": problemResponse("Bad request or validation failed"),
		"429": problemResponse("Rate limited; see Retry-After"),
		"500": problemResponse("Server error"),
	};
	if (entry.meta.scope === "public") return base;
	return {
		...base,
		"401": problemResponse("No valid credentials"),
		"403": problemResponse("Missing scope, or the API is turned off"),
	};
}

function decorateOperation(op: JsonObject, entry: ContractEntry) {
	const scope = entry.meta.scope;
	op.security =
		scope === "public" || !scope
			? []
			: [
					{ bearerAuth: [scope] },
					{ apiKeyAuth: [scope] },
					{ cookieAuth: [scope] },
				];
	op["x-required-scope"] = scope ?? null;
	if (entry.meta.event) op["x-event-type"] = entry.meta.event;
	const responses = (op.responses ?? {}) as JsonObject;
	for (const status of Object.keys(responses)) {
		if (Number(status) >= 400) delete responses[status];
	}
	op.responses = { ...responses, ...errorResponses(entry) };
	if (entry.method !== "GET") {
		const params = (op.parameters ?? []) as JsonObject[];
		op.parameters = [
			...params,
			{
				name: "Idempotency-Key",
				in: "header",
				required: true,
				schema: { type: "string", maxLength: 255 },
			},
		];
	}
}

/**
 * Builds openapi.json from the contract. The output is deterministic (no
 * timestamps, stable key order) so the committed file can be diffed in CI.
 */
export async function generateOpenApiDocument() {
	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});
	const doc = (await generator.generate(contract, {
		info: {
			title: "Retrospend API",
			version: CONTRACT_VERSION,
			description:
				"The public Retrospend API. Errors are RFC 9457 problem+json with a stable `code`. Every write needs an `Idempotency-Key`.",
		},
		servers: [{ url: API_PREFIX }],
		commonSchemas: {
			Money: { schema: moneySchema },
			Problem: { schema: problemSchema },
		},
	})) as unknown as JsonObject;

	const components = (doc.components ?? {}) as JsonObject;
	components.securitySchemes = SECURITY_SCHEMES;
	doc.components = components;

	const paths = (doc.paths ?? {}) as Record<string, Record<string, JsonObject>>;
	for (const entry of listContractRoutes(contract)) {
		const op = entry.path
			? paths[entry.path]?.[entry.method.toLowerCase()]
			: undefined;
		if (!op) throw new Error(`No OpenAPI operation for ${entry.key.join(".")}`);
		decorateOperation(op, entry);
	}
	return doc;
}

/** Stable JSON: sorted object keys, tab indent, trailing newline. */
export function stableStringify(value: unknown): string {
	const sort = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.keys(v as JsonObject)
					.sort()
					.map((k) => [k, sort((v as JsonObject)[k])]),
			);
		}
		return v;
	};
	return `${JSON.stringify(sort(value), null, "\t")}\n`;
}
