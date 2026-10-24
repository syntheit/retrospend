/**
 * Every G2 route (expenses, income, transfers, recurring, needs-you and the
 * glance) refuses a caller without credentials (401) and a token that lacks
 * the route's scope (403 missing_scope), before any input is read or
 * anything is written. Preview twins need the scope of the write they
 * preview, and every write needs an Idempotency-Key.
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

const G2 = ["expenses", "income", "needs-you", "recurring", "transfers"];

const routes = listContractRoutes(contract).filter(
	(r) =>
		G2.includes(r.key[0] ?? "") ||
		(r.key[0] === "figures" && r.key[1] === "glance"),
);

/**
 * This file sends hundreds of requests in a minute, so it comes from its own
 * address and never uses up the per-IP limit the other v1 files share.
 */
const OWN_IP = { "x-forwarded-for": "198.51.100.77" };

/** A concrete path: every `{param}` filled with a placeholder id. */
const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

describe("G2 routes: authentication, scopes and idempotency", () => {
	useApiV1();
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("covers every G2 group", () => {
		expect(new Set(routes.map((r) => r.key[0]))).toEqual(
			new Set([...G2, "figures"]),
		);
		expect(routes.length).toBeGreaterThan(35);
	});

	it("gives every money write a preview twin and an undo", () => {
		const writes = routes.filter((r) => r.meta.scope === "write:money");
		expect(writes.length).toBeGreaterThan(8);
		const paths = new Set(routes.map((r) => `${r.method} ${r.path}`));
		for (const w of writes.filter((r) => !r.path?.endsWith("/preview")))
			expect(paths.has(`POST ${w.path}/preview`), String(w.path)).toBe(true);
		for (const group of ["expenses", "income", "transfers", "recurring"])
			expect(paths.has(`POST /${group}/undo`), group).toBe(true);
	});

	it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s needs credentials",
		async (_name, r) => {
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				headers: OWN_IP,
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
				headers: { ...OWN_IP, "x-api-key": key },
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
			headers: { ...OWN_IP, "x-api-key": key },
			body: {},
		});
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("idempotency_key_required");
	});
});
