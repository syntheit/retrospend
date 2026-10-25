/**
 * Every G1 route (settings, profile, categories, currencies, search,
 * notifications, push, tokens) refuses a caller without credentials (401)
 * and a token that lacks the route's scope (403 missing_scope), before any
 * input is read or anything is written.
 */
import { contract, listContractRoutes, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	apiKeyFor,
	call,
	createTestUser,
	expectProblem,
} from "./harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const G1 = [
	"categories",
	"currencies",
	"notifications",
	"profile",
	"push",
	"search",
	"settings",
	"tokens",
];

const routes = listContractRoutes(contract).filter((r) =>
	G1.includes(r.key[0] ?? ""),
);

/** A concrete path: every `{param}` filled with a placeholder id. */
const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

describe("G1 routes: authentication and scopes", () => {
	let adminId: string;

	beforeAll(async () => {
		// An admin, so even the admin route is refused only for its scope.
		adminId = (await createTestUser({ role: "ADMIN" })).user.id;
	});

	it("covers every G1 group", () => {
		expect(new Set(routes.map((r) => r.key[0]))).toEqual(new Set(G1));
		expect(routes.length).toBeGreaterThan(40);
	});

	it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s needs credentials",
		async (_name, r) => {
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				idempotent: r.method !== "GET",
			});
			await expectProblem(res, 401, "unauthenticated");
		},
	);

	it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
		"%s answers missing_scope without its scope",
		async (_name, r) => {
			const others = SCOPES.filter((s) => s !== r.meta.scope);
			const key = await apiKeyFor(adminId, others);
			const res = await call(pathOf(r.path ?? ""), {
				method: r.method,
				headers: { "x-api-key": key },
				idempotent: r.method !== "GET",
				body: r.method === "GET" ? undefined : {},
			});
			await expectProblem(res, 403, "missing_scope");
		},
	);
});
