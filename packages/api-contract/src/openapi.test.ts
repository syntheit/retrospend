import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateOpenApiDocument, stableStringify } from "./openapi";

const COMMITTED = join(import.meta.dirname, "..", "openapi.json");

describe("openapi.json", () => {
	it("matches the contract (regenerate with scripts/write-openapi.ts)", async () => {
		const generated = stableStringify(await generateOpenApiDocument());
		expect(generated).toBe(readFileSync(COMMITTED, "utf8"));
	});

	it("is OpenAPI 3.1 with problem+json errors and scoped security", async () => {
		const doc = (await generateOpenApiDocument()) as {
			openapi: string;
			paths: Record<string, Record<string, Record<string, unknown>>>;
		};
		expect(doc.openapi).toMatch(/^3\.1\./);

		const me = doc.paths["/me"]?.get;
		expect(me?.security).toEqual([
			{ bearerAuth: ["read"] },
			{ apiKeyAuth: ["read"] },
			{ cookieAuth: ["read"] },
		]);
		const responses = (me?.responses ?? {}) as Record<
			string,
			{ content: object }
		>;
		const forbidden = responses["403"];
		expect(Object.keys(forbidden?.content ?? {})).toEqual([
			"application/problem+json",
		]);

		expect(doc.paths["/server-info"]?.get?.security).toEqual([]);
	});
});
