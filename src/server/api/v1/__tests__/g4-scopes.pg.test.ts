/**
 * Every G4 route (budget and accounts) refuses a caller without credentials
 * (401) and a token that lacks the route's scope (403 missing_scope), before
 * any input is read or anything is written. Preview twins need the scope of
 * the write they preview, and every write needs an Idempotency-Key.
 */
import { contract, listContractRoutes, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	apiKeyFor,
	call,
	createTestUser,
	expectProblem,
	useApiV1,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const G4 = ["budget", "accounts"];

const routes = listContractRoutes(contract).filter((r) =>
	G4.includes(r.key[0] ?? ""),
);

/**
 * This file sends hundreds of requests in a minute, so each group comes from
 * its own address and never uses up the per-IP limit the other v1 files share.
 */
const ipOf = (r: { key: string[] }) => ({
	"x-forwarded-for": r.key[0] === "budget" ? "198.51.100.79" : "198.51.100.80",
});

/** A concrete path: every `{param}` filled with a placeholder id. */
const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

describe("G4 routes: authentication, scopes and idempotency", () => {
	useApiV1();
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("covers both G4 groups", () => {
		expect(new Set(routes.map((r) => r.key[0]))).toEqual(new Set(G4));
		expect(routes.length).toBeGreaterThan(100);
	});

	it("gives every money write a preview twin, and each group an undo", () => {
		const writes = routes.filter((r) => r.meta.scope === "write:money");
		expect(writes.length).toBeGreaterThan(30);
		const paths = new Set(routes.map((r) => `${r.method} ${r.path}`));
		for (const w of writes.filter((r) => !r.path?.endsWith("/preview")))
			expect(paths.has(`POST ${w.path}/preview`), String(w.path)).toBe(true);
		for (const group of ["budget", "accounts"])
			expect(paths.has(`POST /${group}/undo`), group).toBe(true);
	});

	it("keeps every money-free write on write:settings", () => {
		const settings = routes.filter((r) => r.meta.scope === "write:settings");
		expect(settings.length).toBeGreaterThan(10);
		for (const r of settings) expect(r.meta.previewOf).toBeUndefined();
	});

	it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s needs credentials",
		async (_name, r) => {
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				headers: ipOf(r),
				idempotent: r.method !== "GET",
			});
			await expectProblem(res, 401, "unauthenticated");
		},
	);

	it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s answers missing_scope without its scope",
		async (_name, r) => {
			const others = SCOPES.filter((s) => s !== r.meta.scope && s !== "admin");
			const key = await apiKeyFor(userId, others);
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				headers: { ...ipOf(r), "x-api-key": key },
				idempotent: r.method !== "GET",
				body: r.method === "GET" ? undefined : {},
			});
			await expectProblem(res, 403, "missing_scope");
		},
	);

	it.each(
		routes
			.filter((r) => r.method !== "GET" && !r.meta.previewOf)
			.map((r) => [`${r.method} ${r.path}`, r] as const),
	)("%s needs an Idempotency-Key", async (_name, r) => {
		const key = await apiKeyFor(userId, [r.meta.scope as never]);
		const res = await call(pathOf(r.path ?? ""), {
			method: r.method,
			headers: { ...ipOf(r), "x-api-key": key },
			body: {},
		});
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("idempotency_key_required");
	});
});
