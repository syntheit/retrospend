/**
 * /api/v1 end to end on a real Postgres: every credential type resolves to
 * one principal, RLS holds through the user-scoped client, scopes and the
 * apiV1 flag gate routes, and rate limits and idempotency use their tables.
 * Requests go through the same fetch handler the Next route uses.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { implement } from "@orpc/server";
import { contract } from "@retrospend/api-contract";
import { v1 as probe } from "@retrospend/api-contract/common";
import { makeSignature } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { pruneExpiredKeys } from "~/server/services/api-v1/idempotency.service";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { FeatureFlagMode } from "~prisma";
import { createV1Handler, handleV1Request } from "../handler";
import { signedIn, type V1InitialContext, v1Middleware } from "../middleware";
import { RATE_LIMITS } from "../rate-limit";

// better-auth's database hooks read request headers through next/headers,
// which only exists inside a Next request.
vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// A probe group that reads and writes RLS-scoped rows (categories), so the
// tests can watch RLS, scopes and idempotency without real resource routes.
const testContract = {
	...contract,
	probe: {
		list: probe
			.route({
				method: "GET",
				path: "/probe/categories",
				operationId: "probeList",
			})
			.meta({ scope: "read" })
			.output(z.object({ names: z.array(z.string()) })),
		create: probe
			.route({
				method: "POST",
				path: "/probe/categories",
				operationId: "probeCreate",
				successStatus: 201,
			})
			.meta({ scope: "write:expenses", event: "category.created" })
			.input(z.object({ name: z.string().min(1) }))
			.output(z.object({ id: z.string(), name: z.string() })),
		// Writes a category and answers with a body too big to keep for replay.
		big: probe
			.route({ method: "POST", path: "/probe/big", operationId: "probeBig" })
			.meta({ scope: "write:expenses", event: "category.created" })
			.input(z.object({ name: z.string().min(1) }))
			.output(z.object({ blob: z.string() })),
		// Writes a category and answers with a value the store cannot keep
		// (JSON.stringify throws on a bigint), so storing fails after commit.
		unstorable: probe
			.route({
				method: "POST",
				path: "/probe/unstorable",
				operationId: "probeUnstorable",
			})
			.meta({ scope: "write:expenses", event: "category.created" })
			.input(z.object({ name: z.string().min(1) }))
			.output(z.object({ n: z.bigint() })),
	},
};

async function writeCategory(
	context: Parameters<typeof signedIn>[0],
	name: string,
) {
	const user = signedIn(context);
	await user.db.category.create({
		data: { name, color: "blue", userId: user.principal.userId },
	});
}
const t = implement(testContract)
	.$context<V1InitialContext>()
	.use(v1Middleware);
const probeHandler = createV1Handler(
	t.router({
		figures: {
			read: t.figures.read.handler(() => {
				throw new Error("unused");
			}),
		},
		platform: {
			serverInfo: t.platform.serverInfo.handler(() => {
				throw new Error("unused");
			}),
			me: t.platform.me.handler(() => {
				throw new Error("unused");
			}),
		},
		probe: {
			list: t.probe.list.handler(async ({ context }) => {
				const rows = await signedIn(context).db.category.findMany({
					orderBy: { name: "asc" },
				});
				return { names: rows.map((r) => r.name) };
			}),
			create: t.probe.create.handler(async ({ context, input }) => {
				const user = signedIn(context);
				return user.db.category.create({
					data: {
						name: input.name,
						color: "blue",
						userId: user.principal.userId,
					},
					select: { id: true, name: true },
				});
			}),
			big: t.probe.big.handler(async ({ context, input }) => {
				await writeCategory(context, input.name);
				return { blob: "x".repeat(70_000) };
			}),
			unstorable: t.probe.unstorable.handler(async ({ context, input }) => {
				await writeCategory(context, input.name);
				return { n: 1n };
			}),
		},
	}),
);

const BASE = "http://localhost:3101/api/v1";

function call(
	path: string,
	init: {
		method?: string;
		headers?: Record<string, string>;
		body?: unknown;
	} = {},
	handler = handleV1Request,
) {
	const headers = new Headers(init.headers);
	if (init.body !== undefined) headers.set("content-type", "application/json");
	return handler(
		new Request(`${BASE}${path}`, {
			method: init.method ?? "GET",
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}),
	);
}

async function sessionFor(
	userId: string,
	extra: { scopes?: string; clientId?: string } = {},
) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date(Date.now() + 86_400_000),
			...extra,
		},
	});
	return token;
}

const AUTH_BASE = new URL(auth.options.baseURL ?? "http://localhost:1997")
	.origin;

/** A signed session cookie for a fresh unscoped (web) session. */
async function webCookieFor(userId: string) {
	const token = await sessionFor(userId);
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function apiKeyFor(userId: string, scopes: string[]) {
	const created = await auth.api.createApiKey({
		body: { userId, name: "test", permissions: { scopes } },
	});
	return { key: created.key, id: created.id };
}

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe("/api/v1 on Postgres", () => {
	let alice: TestUser;
	let bob: TestUser;
	let admin: TestUser;
	let initialMode: FeatureFlagMode = "OFF";

	// Test files share one database: leave the flag as this file found it.
	afterAll(async () => {
		await updateAppSettings({ apiV1Mode: initialMode });
	});

	beforeAll(async () => {
		// updateAppSettings' upsert drops the flag columns when it has to
		// create the row, so make sure the row exists first.
		initialMode = (await getAppSettings()).apiV1Mode;
		await updateAppSettings({ apiV1Mode: "ALL" });
		alice = await createTestUser();
		bob = await createTestUser();
		admin = await createTestUser({ role: "ADMIN" });
		await adminDb.category.createMany({
			data: [
				{ name: "Groceries", color: "emerald", userId: alice.user.id },
				{ name: "Rent", color: "blue", userId: bob.user.id },
			],
		});
	});

	describe("server-info", () => {
		it("is public and lists the auth methods", async () => {
			const res = await call("/server-info");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toMatchObject({
				name: "Retrospend",
				apiVersion: "v1",
				features: { apiV1: true },
				auth: { signUp: "open" },
				push: { transports: [] },
			});
			expect(body.auth.methods).toContain("deviceAuthorization");
		});
	});

	describe("figures", () => {
		it("answers not_found for an unregistered figure id", async () => {
			const token = await sessionFor(alice.user.id);
			const res = await call("/figures?ids=nope.notAFigure", {
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(404);
			expect((await res.json()).code).toBe("not_found");
		});

		it("lists the bad field when validation fails", async () => {
			const token = await sessionFor(alice.user.id);
			const res = await call("/figures?ids=Bad%20Id", {
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.code).toBe("validation_failed");
			expect(body.errors[0].path).toBe("ids");
		});
	});

	describe("principals", () => {
		it("rejects a request without credentials as problem+json", async () => {
			const res = await call("/me");
			expect(res.status).toBe(401);
			expect(res.headers.get("content-type")).toBe("application/problem+json");
			expect(await res.json()).toMatchObject({
				type: "urn:retrospend:problem:unauthenticated",
				status: 401,
				code: "unauthenticated",
			});
		});

		it("treats an unstamped bearer session as mobile, without admin", async () => {
			const token = await sessionFor(admin.user.id);
			const res = await call("/me", {
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(200);
			const me = await res.json();
			expect(me.id).toBe(admin.user.id);
			expect(me.principal.kind).toBe("mobile");
			expect(me.principal.scopes).not.toContain("admin");
		});

		it("rejects an unknown bearer token", async () => {
			const res = await call("/me", {
				headers: { authorization: "Bearer nope" },
			});
			expect(res.status).toBe(401);
		});

		it("resolves an API key by x-api-key and by bearer", async () => {
			const { key } = await apiKeyFor(alice.user.id, ["read"]);
			const variants: Record<string, string>[] = [
				{ "x-api-key": key },
				{ authorization: `Bearer ${key}` },
			];
			for (const headers of variants) {
				const res = await call("/me", { headers });
				expect(res.status).toBe(200);
				const me = await res.json();
				expect(me.id).toBe(alice.user.id);
				expect(me.principal).toMatchObject({
					kind: "apiKey",
					scopes: ["read"],
				});
			}
		});

		it("stores only the API key hash and always sets an expiry", async () => {
			const { key, id } = await apiKeyFor(alice.user.id, ["read"]);
			const row = await adminDb.apikey.findUniqueOrThrow({ where: { id } });
			const hash = createHash("sha256").update(key).digest("base64url");
			expect(key.startsWith("rsk_")).toBe(true);
			expect(row.key).toBe(hash);
			expect(row.key).not.toContain(key);
			const days = ((row.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
			expect(Math.round(days)).toBe(90);
		});

		it("never lets a client drop a key's expiry or pick its prefix", async () => {
			// Managing keys needs the web app's cookie session.
			const cookie = await webCookieFor(alice.user.id);
			const { id } = await apiKeyFor(alice.user.id, ["read"]);
			const post = (path: string, body: unknown) =>
				auth.handler(
					new Request(`${AUTH_BASE}/api/auth${path}`, {
						method: "POST",
						headers: {
							cookie,
							"content-type": "application/json",
							origin: AUTH_BASE,
						},
						body: JSON.stringify(body),
					}),
				);

			expect(
				(await post("/api-key/update", { keyId: id, expiresIn: null })).status,
			).toBe(400);
			expect(
				(await post("/api-key/create", { name: "x", prefix: "sk_" })).status,
			).toBe(400);
			const row = await adminDb.apikey.findUniqueOrThrow({ where: { id } });
			expect(row.expiresAt).not.toBeNull();

			const created = await post("/api-key/create", { name: "client" });
			expect(created.status).toBe(200);
			const body = await created.json();
			expect(body.key.startsWith("rsk_")).toBe(true);
			expect(body.permissions).toEqual({ scopes: ["read"] });
		});

		it("rejects an expired API key and a deactivated user's key", async () => {
			const expired = await apiKeyFor(alice.user.id, ["read"]);
			await adminDb.apikey.update({
				where: { id: expired.id },
				data: { expiresAt: new Date(Date.now() - 1000) },
			});
			expect(
				(await call("/me", { headers: { "x-api-key": expired.key } })).status,
			).toBe(401);

			const off = await createTestUser();
			const offKey = await apiKeyFor(off.user.id, ["read"]);
			await adminDb.user.update({
				where: { id: off.user.id },
				data: { isActive: false },
			});
			expect(
				(await call("/me", { headers: { "x-api-key": offKey.key } })).status,
			).toBe(401);
		});

		it("refuses device codes for unknown clients or scopes", async () => {
			await expect(
				auth.api.deviceCode({ body: { client_id: "someone-else" } }),
			).rejects.toThrow();
			await expect(
				auth.api.deviceCode({
					body: { client_id: "retrospend-cli", scope: "root" },
				}),
			).rejects.toThrow();
		});

		it("resolves a web cookie session with every scope", async () => {
			const email = `${randomUUID()}@pg-test.invalid`;
			const signUp = await auth.api.signUpEmail({
				body: {
					email,
					password: "correct horse battery",
					name: "Cookie",
					username: `c${randomBytes(6).toString("hex")}`,
				},
				asResponse: true,
			});
			const setCookie = signUp.headers.get("set-cookie") ?? "";
			const sessionCookie = setCookie.split(";")[0] ?? "";
			expect(sessionCookie).toMatch(/session_token=/);

			const res = await call("/me", { headers: { cookie: sessionCookie } });
			expect(res.status).toBe(200);
			expect((await res.json()).principal).toMatchObject({
				kind: "web",
				scopes: ["read", "write:expenses", "write:money", "write:settings"],
			});
		});
	});

	describe("RLS through v1", () => {
		it("shows each user only their own rows, whatever the credential", async () => {
			const aliceKey = await apiKeyFor(alice.user.id, ["read"]);
			const bobToken = await sessionFor(bob.user.id);

			const a = await call(
				"/probe/categories",
				{ headers: { "x-api-key": aliceKey.key } },
				probeHandler,
			);
			const b = await call(
				"/probe/categories",
				{ headers: { authorization: `Bearer ${bobToken}` } },
				probeHandler,
			);
			expect((await a.json()).names).toEqual(["Groceries"]);
			expect((await b.json()).names).toEqual(["Rent"]);
		});
	});

	describe("scopes and the apiV1 flag", () => {
		it("answers 403 missing_scope for a token without the route's scope", async () => {
			const { key } = await apiKeyFor(alice.user.id, ["read"]);
			const res = await call(
				"/probe/categories",
				{
					method: "POST",
					headers: { "x-api-key": key, "idempotency-key": randomUUID() },
					body: { name: "Nope" },
				},
				probeHandler,
			);
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({
				code: "missing_scope",
				requiredScope: "write:expenses",
			});
			await expect(
				adminDb.category.count({
					where: { userId: alice.user.id, name: "Nope" },
				}),
			).resolves.toBe(0);
		});

		it("gates everything but server-info on apiV1Mode", async () => {
			const userToken = await sessionFor(alice.user.id);
			const adminToken = await sessionFor(admin.user.id);
			const as = (token: string) => ({
				headers: { authorization: `Bearer ${token}` },
			});
			try {
				await updateAppSettings({ apiV1Mode: "OFF" });
				const off = await call("/me", as(adminToken));
				expect(off.status).toBe(403);
				expect((await off.json()).code).toBe("api_disabled");
				const info = await call("/server-info");
				expect(info.status).toBe(200);
				expect((await info.json()).features.apiV1).toBe(false);

				await updateAppSettings({ apiV1Mode: "ADMINS" });
				expect((await call("/me", as(userToken))).status).toBe(403);
				expect((await call("/me", as(adminToken))).status).toBe(200);
				const adminInfo = await call("/server-info", as(adminToken));
				expect((await adminInfo.json()).features.apiV1).toBe(true);
			} finally {
				await updateAppSettings({ apiV1Mode: "ALL" });
			}
		});
	});

	describe("rate limits", () => {
		it("answers 429 with Retry-After once a token's window is full", async () => {
			const { key, id } = await apiKeyFor(alice.user.id, ["read"]);
			const { limit, windowMs } = RATE_LIMITS.perToken;
			const windowStart = new Date(
				Math.floor(Date.now() / windowMs) * windowMs,
			);
			await adminDb.apiRateLimit.create({
				data: { key: `tok:apiKey:${id}`, windowStart, count: limit },
			});

			const res = await call("/me", { headers: { "x-api-key": key } });
			expect(res.status).toBe(429);
			const retryAfter = Number(res.headers.get("retry-after"));
			expect(retryAfter).toBeGreaterThanOrEqual(1);
			expect(retryAfter).toBeLessThanOrEqual(60);
			expect(await res.json()).toMatchObject({
				code: "rate_limited",
				retryAfter,
			});
		});
	});

	describe("idempotency", () => {
		const write = (key: string | undefined, body: unknown, token: string) =>
			call(
				"/probe/categories",
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${token}`,
						...(key ? { "idempotency-key": key } : {}),
					},
					body,
				},
				probeHandler,
			);

		it("requires the header on writes", async () => {
			const token = await sessionFor(alice.user.id);
			const res = await write(undefined, { name: "Keyless" }, token);
			expect(res.status).toBe(400);
			expect((await res.json()).code).toBe("idempotency_key_required");
		});

		it("replays the first response and writes once", async () => {
			const token = await sessionFor(alice.user.id);
			const key = randomUUID();
			const first = await write(key, { name: "Travel" }, token);
			const second = await write(key, { name: "Travel" }, token);

			expect(first.status).toBe(201);
			expect(second.status).toBe(201);
			expect(second.headers.get("idempotent-replayed")).toBe("true");
			expect(await second.json()).toEqual(await first.json());
			await expect(
				adminDb.category.count({
					where: { userId: alice.user.id, name: "Travel" },
				}),
			).resolves.toBe(1);
		});

		it("refuses the same key for a different request", async () => {
			const token = await sessionFor(alice.user.id);
			const key = randomUUID();
			expect((await write(key, { name: "Gifts" }, token)).status).toBe(201);
			const reused = await write(key, { name: "Other" }, token);
			expect(reused.status).toBe(422);
			expect((await reused.json()).code).toBe("idempotency_key_reused");
		});

		it("frees the key when the request fails", async () => {
			const token = await sessionFor(alice.user.id);
			const key = randomUUID();
			// Groceries already exists for Alice: the unique index fails the write.
			expect((await write(key, { name: "Groceries" }, token)).status).toBe(500);
			await expect(
				adminDb.idempotencyKey.count({ where: { userId: alice.user.id, key } }),
			).resolves.toBe(0);
		});

		it("never frees a key once the write committed", async () => {
			const token = await sessionFor(alice.user.id);
			const key = randomUUID();
			const send = () =>
				call(
					"/probe/unstorable",
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${token}`,
							"idempotency-key": key,
						},
						body: { name: "Committed once" },
					},
					probeHandler,
				);
			expect((await send()).status).toBe(500);
			const retry = await send();
			expect(retry.status).toBe(409);
			expect((await retry.json()).code).toBe("idempotency_in_progress");
			await expect(
				adminDb.category.count({
					where: { userId: alice.user.id, name: "Committed once" },
				}),
			).resolves.toBe(1);
		});

		it("keeps no copy of a response over the size cap", async () => {
			const token = await sessionFor(alice.user.id);
			const key = randomUUID();
			const send = () =>
				call(
					"/probe/big",
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${token}`,
							"idempotency-key": key,
						},
						body: { name: "Big body" },
					},
					probeHandler,
				);
			expect((await send()).status).toBe(200);
			const replay = await send();
			expect(replay.status).toBe(409);
			expect((await replay.json()).code).toBe("idempotency_replay_unavailable");
			await expect(
				adminDb.category.count({
					where: { userId: alice.user.id, name: "Big body" },
				}),
			).resolves.toBe(1);
		});

		it("prunes only the caller's expired keys", async () => {
			const past = new Date(Date.now() - 1000);
			for (const userId of [alice.user.id, bob.user.id]) {
				await adminDb.idempotencyKey.create({
					data: {
						userId,
						key: `old-${randomUUID()}`,
						requestHash: "x",
						expiresAt: past,
					},
				});
			}
			expect(await pruneExpiredKeys(alice.db)).toBeGreaterThanOrEqual(1);
			await expect(
				adminDb.idempotencyKey.count({
					where: { userId: alice.user.id, expiresAt: { lt: new Date() } },
				}),
			).resolves.toBe(0);
			await expect(
				adminDb.idempotencyKey.count({
					where: { userId: bob.user.id, expiresAt: { lt: new Date() } },
				}),
			).resolves.toBeGreaterThanOrEqual(1);
		});

		it("keeps keys per user under RLS", async () => {
			const key = randomUUID();
			const aliceToken = await sessionFor(alice.user.id);
			const bobToken = await sessionFor(bob.user.id);
			expect(
				(await write(key, { name: "Shared key" }, aliceToken)).status,
			).toBe(201);
			const bobRes = await write(key, { name: "Shared key" }, bobToken);
			expect(bobRes.status).toBe(201);
			expect(bobRes.headers.get("idempotent-replayed")).toBeNull();

			await expect(
				alice.db.idempotencyKey.count({ where: { key } }),
			).resolves.toBe(1);
			await expect(
				alice.db.idempotencyKey.count({ where: { userId: bob.user.id } }),
			).resolves.toBe(0);
		});
	});
});
