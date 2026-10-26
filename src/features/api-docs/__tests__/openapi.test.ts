import openapi from "@retrospend/api-contract/openapi.json";
import { listContractRoutes, contract } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import {
	flattenSchema,
	groupsOf,
	MAX_ROWS,
	type OpenApiDocument,
	slugOf,
	typeLabel,
} from "../openapi";

const doc = openapi as unknown as OpenApiDocument;

describe("groupsOf", () => {
	const groups = groupsOf(doc);
	const all = groups.flatMap((g) => g.operations);

	it("lists every operation of the document once, under its tag", () => {
		const count = Object.values(doc.paths).reduce(
			(n, item) =>
				n +
				["get", "post", "put", "patch", "delete"].filter((m) => item[m]).length,
			0,
		);
		expect(all).toHaveLength(count);
		expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
		// The contract's routes are the document's operations.
		expect(all.length).toBe(listContractRoutes(contract).length);
	});

	it("gives every group a distinct address", () => {
		expect(new Set(groups.map((g) => g.slug)).size).toBe(groups.length);
		expect(slugOf("Invite codes")).toBe("invite-codes");
		expect(groups.map((g) => g.slug)).toContain("webhooks");
	});

	it("names the scope of every operation and the event of every write", () => {
		for (const op of all) {
			expect(op.scope, op.id).toBeTruthy();
			if (op.method === "GET") expect(op.event, op.id).toBeNull();
		}
	});

	it("reads a create route: body fields, required marks, the success status", () => {
		const create = all.find((o) => o.id === "createAccessToken");
		expect(create?.method).toBe("POST");
		expect(create?.path).toBe("/tokens");
		expect(create?.scope).toBe("write:settings");
		expect(create?.event).toBe("token.created");
		expect(create?.responseStatus).toBe("201");
		const name = create?.request?.find((r) => r.path === "name");
		expect(name).toMatchObject({ type: "string", required: true });
		const scopes = create?.request?.find((r) => r.path === "scopes");
		expect(scopes?.type).toContain("[]");
		// The key is in the response, once.
		expect(create?.response?.some((r) => r.path === "key")).toBe(true);
	});

	it("keeps the idempotency header out of the parameter tables", () => {
		for (const op of all)
			expect(op.params.map((p) => p.path)).not.toContain("Idempotency-Key");
	});

	it("lists path and query parameters", () => {
		const get = all.find((o) => o.id === "getWebhook");
		expect(get?.params).toEqual([
			expect.objectContaining({ where: "path", path: "id", required: true }),
		]);
		const list = all.find((o) => o.id === "listAccessTokens");
		expect(list?.params.map((p) => p.path)).toEqual(["cursor", "limit"]);
	});

	it("caps a very large body and says how many fields it left out", () => {
		for (const op of all) {
			expect(op.request?.length ?? 0).toBeLessThanOrEqual(MAX_ROWS);
			expect(op.response?.length ?? 0).toBeLessThanOrEqual(MAX_ROWS);
		}
	});
});

describe("flattenSchema and typeLabel", () => {
	const small: OpenApiDocument = {
		info: { title: "t", version: "1" },
		paths: {},
		components: {
			schemas: {
				Money: {
					type: "object",
					required: ["minor"],
					properties: { minor: { type: "integer" }, note: { type: "string" } },
				},
			},
		},
	};

	it("resolves references and marks nullable and enum types", () => {
		expect(typeLabel(small, { $ref: "#/components/schemas/Money" })).toBe(
			"object",
		);
		expect(
			typeLabel(small, { anyOf: [{ type: "string" }, { type: "null" }] }),
		).toBe("string | null");
		expect(typeLabel(small, { enum: ["a", "b"], type: "string" })).toBe(
			'"a" | "b"',
		);
		expect(
			typeLabel(small, { type: "string", format: "date-time" }),
		).toBe("string (date-time)");
	});

	it("nests fields as dotted paths, arrays with brackets", () => {
		const { rows } = flattenSchema(small, {
			type: "object",
			required: ["items"],
			properties: {
				items: { type: "array", items: { $ref: "#/components/schemas/Money" } },
				total: { $ref: "#/components/schemas/Money" },
			},
		});
		expect(rows.map((r) => r.path)).toEqual([
			"items",
			"items[].minor",
			"items[].note",
			"total",
			"total.minor",
			"total.note",
		]);
		expect(rows.find((r) => r.path === "items")?.required).toBe(true);
		expect(rows.find((r) => r.path === "items[].minor")?.required).toBe(true);
	});

	it("shows a default in the description", () => {
		const { rows } = flattenSchema(small, {
			type: "object",
			properties: { limit: { type: "integer", default: 50 } },
		});
		expect(rows[0]?.description).toBe("Default: 50.");
	});
});
