/**
 * The groups that closed the v1 completeness gaps (account deletion,
 * corrections, billing periods, payment methods, activity) refuse a caller
 * without credentials (401) and a token that lacks the route's scope (403
 * missing_scope), before any input is read or anything is written. Every
 * write needs an Idempotency-Key, and a session-only scope is never held by
 * a token. Preview twins need the scope of the write they preview. The
 * gaps closed inside existing groups are covered by those groups' own scope
 * files (g3-scopes for people, payments, projects).
 */
import { contract, listContractRoutes, SCOPES } from "@retrospend/api-contract";
import { isSessionScope } from "@retrospend/api-contract/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	apiKeyFor,
	asMobile,
	call,
	createTestUser,
	expectProblem,
	useApiV1,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const GROUPS = ["account", "corrections", "billing-periods", "payment-methods"];

const routes = listContractRoutes(contract).filter((r) =>
	GROUPS.includes(r.key[0] ?? ""),
);

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.79" };

const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

describe("gap-closing routes: authentication, scopes and idempotency", () => {
	useApiV1();
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("covers every group", () => {
		expect(new Set(routes.map((r) => r.key[0]))).toEqual(new Set(GROUPS));
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
		const scope = r.meta.scope as string;
		// A session scope is held by the app's own session, never by a key.
		const headers = isSessionScope(scope)
			? await asMobile(userId)
			: { "x-api-key": await apiKeyFor(userId, [scope as never]) };
		const res = await call(pathOf(r.path ?? ""), {
			method: r.method,
			headers: { ...OWN_IP, ...headers },
			body: {},
		});
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("idempotency_key_required");
	});
});
