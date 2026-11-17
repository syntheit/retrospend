/**
 * Deny by default, through the real wiring. Every tRPC procedure and every v1
 * route is called as an account with protection on, then as one with it off.
 * The lists are not read to decide what to expect from the transport: a route
 * that is not allowlisted must be refused, and one that is must not be, so
 * deleting a guard call (trpc.ts protectionGuard, v1 authenticate) fails here,
 * and a route added later is covered without touching this file.
 *
 * The database refuses every call, and counts them: a refusal has to happen
 * before anything is read or written (no keyring, no time zone claim, no
 * idempotency record).
 */
import { contract, listContractRoutes } from "@retrospend/api-contract";
import openapi from "@retrospend/api-contract/openapi.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("~/server/db", async (importOriginal) => {
	const refusing: unknown = new Proxy(() => undefined, {
		get: (_target, prop) =>
			prop === "then" || typeof prop === "symbol" ? undefined : refusing,
		apply: () => {
			dbCalls.count++;
			return Promise.reject(new Error("the database was reached"));
		},
	});
	return {
		...(await importOriginal<typeof import("~/server/db")>()),
		db: refusing,
		createUserScopedDb: () => refusing,
	};
});

vi.mock("~/server/services/api-v1/rate-limit.service", () => ({
	consumeRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

const principalState = vi.hoisted(() => ({ protected: false }));

vi.mock("~/server/services/api-v1/principal.service", () => ({
	API_KEY_PREFIX: "rsk_",
	resolvePrincipal: async () => ({
		ok: true,
		principal: {
			kind: "web",
			userId: "walk-user",
			role: "ADMIN",
			scopes: [
				"read",
				"write:expenses",
				"write:money",
				"write:settings",
				"admin",
			],
			sessionScopes: ["account:delete", "account:security", "sync", "vault"],
			tokenId: "walk-token",
			expiresAt: null,
			clientId: null,
			protected: principalState.protected,
		},
	}),
}));

import { appRouter, createCaller } from "~/server/api/root";
import { errorFormatter } from "~/server/api/error-formatter";
import { handleV1Request } from "~/server/api/v1/handler";
import { TRPC_ALLOWED, V1_ALLOWED } from "../allowed";
import { ProtectedAccountError } from "../guard";

function sessionFor(state: "ON" | "OFF") {
	return {
		user: {
			id: "walk-user",
			role: "USER",
			email: "walk@example.com",
			name: "Walk",
			username: "walk",
			isActive: true,
			timeZone: "UTC",
			protectionState: state,
		},
		session: { id: "walk-session", token: "walk-token" },
	};
}

const procedures = Object.keys(
	(appRouter as unknown as { _def: { procedures: object } })._def.procedures,
).sort();

/**
 * The dev build delays each call 100 to 500 ms. Move the clock past it, and
 * give a handler that does real work a few turns to settle.
 */
async function settle<T>(run: () => Promise<T>) {
	let outcome: { value: T } | { error: unknown } | undefined;
	run().then(
		(value) => {
			outcome = { value };
		},
		(error) => {
			outcome = { error };
		},
	);
	for (let turn = 0; turn < 20 && !outcome; turn++) {
		await vi.advanceTimersByTimeAsync(600);
		await new Promise((resolve) => setImmediate(resolve));
	}
	if (!outcome) throw new Error("the call never settled");
	return outcome;
}

async function callProcedure(path: string, state: "ON" | "OFF") {
	const caller = createCaller({
		db: undefined as never,
		session: sessionFor(state) as never,
		headers: new Headers(),
	});
	const procedure = path
		.split(".")
		.reduce(
			(node, key) => (node as Record<string, unknown>)[key],
			caller as unknown,
		);
	return settle(() =>
		(procedure as (input?: unknown) => Promise<unknown>)(undefined),
	);
}

const problemOf = (error: unknown) =>
	(
		errorFormatter({
			shape: { data: {} },
			error: error as never,
		}).data as { problem?: string | null }
	).problem;

describe("tRPC", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		// A handler that fails after the guard may log; the walk is about the guard.
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("tRPC: a protected account", () => {
		it("is refused every procedure the allowlist does not name, before any work", async () => {
			const denied = procedures.filter((p) => !(p in TRPC_ALLOWED));
			expect(denied.length).toBeGreaterThan(300);
			const wrong: string[] = [];
			dbCalls.count = 0;
			for (const path of denied) {
				const outcome = await callProcedure(path, "ON");
				const error = "error" in outcome ? outcome.error : null;
				if (
					!(error instanceof ProtectedAccountError) ||
					(error as { code?: string }).code !== "FORBIDDEN" ||
					problemOf(error) !== "protected_account"
				)
					wrong.push(path);
			}
			expect(wrong).toEqual([]);
			expect(dbCalls.count).toBe(0);
		}, 120_000);

		it("is not refused by the guard on a procedure the allowlist names", async () => {
			const allowed = procedures.filter((p) => p in TRPC_ALLOWED);
			expect(allowed.length).toBe(Object.keys(TRPC_ALLOWED).length);
			const refused: string[] = [];
			for (const path of allowed) {
				const outcome = await callProcedure(path, "ON");
				if (
					"error" in outcome &&
					problemOf(outcome.error) === "protected_account"
				)
					refused.push(path);
			}
			expect(refused).toEqual([]);
		}, 120_000);
	});

	describe("tRPC: an account with protection off", () => {
		it("is never given protected_account", async () => {
			const refused: string[] = [];
			for (const path of procedures) {
				const outcome = await callProcedure(path, "OFF");
				if (
					"error" in outcome &&
					problemOf(outcome.error) === "protected_account"
				)
					refused.push(path);
			}
			expect(refused).toEqual([]);
		}, 120_000);
	});
});

describe("API v1", () => {
	const routes = listContractRoutes(contract);
	const pathOf = (path: string) => path.replace(/\{[^}]+\}/g, "x0");

	async function callRoute(
		route: (typeof routes)[number],
		isProtected: boolean,
	) {
		principalState.protected = isProtected;
		const res = await handleV1Request(
			new Request(`http://localhost:3101/api/v1${pathOf(route.path ?? "")}`, {
				method: route.method,
			}),
		);
		return {
			res,
			body: (await res.json().catch(() => null)) as { code?: string } | null,
		};
	}

	it("refuses a protected account every route the allowlist does not name, with an empty body", async () => {
		const isDenied = (r: (typeof routes)[number]) =>
			r.meta.scope !== "public" && !(`${r.method} ${r.path}` in V1_ALLOWED);
		const denied = routes.filter(isDenied);
		expect(denied.length).toBeGreaterThan(300);
		const wrong: string[] = [];
		dbCalls.count = 0;
		for (const route of denied) {
			const { res, body } = await callRoute(route, true);
			if (
				res.status !== 403 ||
				body?.code !== "protected_account" ||
				!res.headers.get("content-type")?.includes("application/problem+json")
			)
				wrong.push(
					`${route.method} ${route.path} -> ${res.status} ${body?.code}`,
				);
		}
		expect(wrong).toEqual([]);
		expect(dbCalls.count).toBe(0);
	}, 120_000);

	it("does not refuse the routes it names, or the public ones", async () => {
		const open = routes.filter(
			(r) => r.meta.scope === "public" || `${r.method} ${r.path}` in V1_ALLOWED,
		);
		expect(open.length).toBeGreaterThan(40);
		const refused: string[] = [];
		for (const route of open) {
			const { body } = await callRoute(route, true);
			if (body?.code === "protected_account")
				refused.push(`${route.method} ${route.path}`);
		}
		expect(refused).toEqual([]);
	}, 120_000);

	it("answers as the committed openapi.json says, for every operation", async () => {
		// The published label is what a client author reads, so the real outcome
		// for a protected account has to equal it: a label that drifts from the
		// guard fails here, in either direction.
		const operations = (
			openapi as unknown as {
				paths: Record<
					string,
					Record<string, { "x-protected-account"?: { allowed?: boolean } }>
				>;
			}
		).paths;
		const wrong: string[] = [];
		for (const route of routes) {
			const label =
				operations[route.path ?? ""]?.[route.method.toLowerCase()]?.[
					"x-protected-account"
				]?.allowed;
			const { body } = await callRoute(route, true);
			const refused = body?.code === "protected_account";
			if (typeof label !== "boolean" || refused === label)
				wrong.push(
					`${route.method} ${route.path}: published ${label}, refused ${refused}`,
				);
		}
		expect(wrong).toEqual([]);
	}, 120_000);

	it("never gives protected_account to an account with protection off", async () => {
		const refused: string[] = [];
		for (const route of routes) {
			const { body } = await callRoute(route, false);
			if (body?.code === "protected_account")
				refused.push(`${route.method} ${route.path}`);
		}
		expect(refused).toEqual([]);
	}, 120_000);
});
