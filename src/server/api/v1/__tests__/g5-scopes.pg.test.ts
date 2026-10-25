/**
 * Every G5 route (imports, exports, admin, feedback, invite codes) refuses a
 * caller without credentials (401) and a token that lacks the route's scope
 * (403 missing_scope), before any input is read or anything is written.
 * Writes need an Idempotency-Key, admin routes need the admin role as well as
 * the admin scope, and preview twins take the scope of the write they preview.
 */
import { contract, listContractRoutes, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	apiKeyFor,
	asKey,
	call,
	createTestUser,
	expectProblem,
	useApiV1,
	webCookieFor,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const G5 = ["imports", "exports", "admin", "feedback", "invite-codes"];

const routes = listContractRoutes(contract).filter((r) =>
	G5.includes(r.key[0] ?? ""),
);

/** Each group comes from its own address, so none uses up the per-IP limit. */
const ipOf = (r: { key: string[] }) => ({
	"x-forwarded-for": `198.51.100.${90 + G5.indexOf(r.key[0] ?? "")}`,
});

const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

describe("G5 routes: authentication, scopes and idempotency", () => {
	useApiV1();
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("covers all five G5 groups", () => {
		expect(new Set(routes.map((r) => r.key[0]))).toEqual(new Set(G5));
		expect(routes.length).toBeGreaterThan(40);
	});

	it("scopes every admin route to admin and nothing else to it", () => {
		for (const r of routes)
			expect(r.meta.scope === "admin", `${r.method} ${r.path}`).toBe(
				r.key[0] === "admin",
			);
	});

	it("gives each import money write a preview twin", () => {
		const paths = new Set(routes.map((r) => `${r.method} ${r.path}`));
		for (const w of ["finalize", "undo"])
			expect(paths.has(`POST /imports/jobs/{id}/${w}/preview`), w).toBe(true);
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
			const others = SCOPES.filter((s) => s !== r.meta.scope);
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
		// A non-admin cannot hold the admin scope, so admin routes use the admin test file.
		if (r.meta.scope === "admin") return;
		const key = await apiKeyFor(userId, [r.meta.scope as never]);
		const res = await call(pathOf(r.path ?? ""), {
			method: r.method,
			headers: { ...ipOf(r), "x-api-key": key },
			body: {},
		});
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("idempotency_key_required");
	});

	const adminRoutes = routes.filter((r) => r.key[0] === "admin");

	it.each(adminRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s refuses a non-admin whose key lists the admin scope",
		async (_name, r) => {
			// The scope is stored on the key, but a user without the role never gets it.
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				headers: { ...ipOf(r), ...(await asKey(userId, ["admin"])) },
				idempotent: r.method !== "GET",
				body: r.method === "GET" ? undefined : {},
			});
			await expectProblem(res, 403, "missing_scope");
		},
	);

	it("refuses a non-admin's web session on an admin route", async () => {
		const res = await call("/admin/stats", {
			headers: { ...ipOf({ key: ["admin"] }), ...(await webCookieFor(userId)) },
		});
		await expectProblem(res, 403, "missing_scope");
	});
});
