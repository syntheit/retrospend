import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateOpenApiDocument, stableStringify } from "./openapi";

const COMMITTED = join(import.meta.dirname, "..", "openapi.json");

describe("openapi.json", () => {
	it("matches the contract (regenerate with scripts/write-openapi.ts)", async () => {
		// Compared as data, so a formatter pass over the file is not a diff.
		const generated = JSON.parse(
			stableStringify(await generateOpenApiDocument()),
		);
		expect(JSON.parse(readFileSync(COMMITTED, "utf8"))).toEqual(generated);
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

	it("declares 410 sync_reset_required on every cursor sync operation only", async () => {
		const doc = (await generateOpenApiDocument()) as {
			paths: Record<string, Record<string, { responses: object }>>;
		};
		const syncPaths = Object.keys(doc.paths).filter((path) =>
			path.startsWith("/sync/"),
		);
		const snapshots = ["/sync/settings", "/sync/shares"];
		const cursorPaths = syncPaths.filter((path) => !snapshots.includes(path));
		expect(cursorPaths).toHaveLength(21);
		expect(syncPaths.filter((path) => snapshots.includes(path)).sort()).toEqual(
			snapshots,
		);
		for (const path of cursorPaths) {
			const responses = doc.paths[path]?.get?.responses as Record<
				string,
				{ content: object }
			>;
			expect(Object.keys(responses["410"]?.content ?? {})).toEqual([
				"application/problem+json",
			]);
		}
		// A snapshot has no cursor to go stale, but is still behind the sync scope.
		for (const path of snapshots)
			expect(doc.paths[path]?.get?.responses).not.toHaveProperty("410");
		expect(doc.paths["/events"]?.get?.responses).not.toHaveProperty("410");
	});
});
