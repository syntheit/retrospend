import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ApiMeta, listContractRoutes } from "./common/meta";
import { contract } from "./index";
import {
	decorateOperation,
	generateOpenApiDocument,
	stableStringify,
} from "./openapi";
import { V1_ALLOWED } from "./protection/v1-allowed";

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

	it("labels every operation for Advanced protection, with only the boolean", async () => {
		const doc = (await generateOpenApiDocument()) as {
			info: { version: string; description: string };
			paths: Record<string, Record<string, Record<string, unknown>>>;
		};
		const routes = listContractRoutes(contract);
		const allowed: string[] = [];
		for (const route of routes) {
			const op = doc.paths[route.path ?? ""]?.[route.method.toLowerCase()];
			const label = op?.["x-protected-account"];
			expect(label, `${route.method} ${route.path}`).toEqual({
				allowed: expect.any(Boolean),
			});
			if ((label as { allowed: boolean }).allowed)
				allowed.push(`${route.method} ${route.path}`);
		}
		// Public routes are never checked, so they are allowed without being listed.
		const publicRoutes = routes
			.filter((r) => r.meta.scope === "public")
			.map((r) => `${r.method} ${r.path}`);
		expect(allowed.sort()).toEqual(
			[...new Set([...Object.keys(V1_ALLOWED), ...publicRoutes])].sort(),
		);
		expect(publicRoutes).toContain("GET /server-info");
		expect(doc.info.version).toBe("1.1.0");
		expect(doc.info.description).toContain("protected_account");
		// The reasons are review notes and stay out of the document.
		expect(JSON.stringify(doc)).not.toContain("Identity: the profile");
	});

	it("names protected_account on the 403 of a denied operation only", async () => {
		const doc = (await generateOpenApiDocument()) as {
			paths: Record<
				string,
				Record<string, { responses: Record<string, { description: string }> }>
			>;
		};
		expect(doc.paths["/expenses"]?.get?.responses["403"]?.description).toContain(
			"protected_account",
		);
		expect(doc.paths["/me"]?.get?.responses["403"]?.description).not.toContain(
			"protected_account",
		);
	});

	describe("the Idempotency-Key header", () => {
		const headerOf = (meta: ApiMeta, method = "POST") => {
			const op: Record<string, unknown> = {};
			decorateOperation(op, {
				key: ["probe"],
				procedure: {} as never,
				meta,
				method,
				path: "/probe",
			});
			return (
				(op.parameters ?? []) as { name: string; required: boolean }[]
			).find((p) => p.name === "Idempotency-Key");
		};

		it("is required on a write, and absent on a public write proved by a token", () => {
			expect(headerOf({ scope: "write:expenses" })?.required).toBe(true);
			expect(headerOf({ scope: "public", publicWrite: "resetToken" })).toBe(
				undefined,
			);
			expect(headerOf({ scope: "public", publicWrite: "resetRequest" })).toBe(
				undefined,
			);
			// readsOnly and GET stay as they were.
			expect(headerOf({ scope: "public", readsOnly: true })).toBe(undefined);
			expect(headerOf({ scope: "read" }, "GET")).toBe(undefined);
		});
	});
});
