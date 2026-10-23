/**
 * Shared helpers for the G1 (core) /api/v1 pg tests. Requests go through
 * the same fetch handler the Next route uses, against a real Postgres, so
 * RLS, scopes and idempotency are the production ones.
 *
 * Each test file still needs its own
 *   vi.mock("next/headers", ...)
 * (better-auth's hooks read request headers through next/headers).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { afterAll, beforeAll, expect } from "vitest";
import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { FeatureFlagMode } from "~prisma";
import { handleV1Request } from "../../handler";

export const BASE = "http://localhost:3101/api/v1";

export type CallInit = {
	method?: string;
	headers?: Record<string, string>;
	/** JSON body. */
	body?: unknown;
	/** multipart/form-data body (file uploads). */
	form?: FormData;
	/** Sends an Idempotency-Key: a fresh one unless a key is given. */
	idempotent?: boolean | string;
};

export function call(path: string, init: CallInit = {}) {
	const headers = new Headers(init.headers);
	if (init.body !== undefined) headers.set("content-type", "application/json");
	if (init.idempotent)
		headers.set(
			"idempotency-key",
			typeof init.idempotent === "string" ? init.idempotent : randomUUID(),
		);
	return handleV1Request(
		new Request(`${BASE}${path}`, {
			method: init.method ?? "GET",
			headers,
			body:
				init.form ??
				(init.body === undefined ? undefined : JSON.stringify(init.body)),
		}),
	);
}

/** What the Expo app's sign-in stamps: every scope but admin. */
export const MOBILE_SCOPES = "read write:expenses write:money write:settings";

/** A session token, the mobile app's by default, to send as a bearer. */
export async function sessionFor(
	userId: string,
	extra: { scopes?: string; clientId?: string } = {
		scopes: MOBILE_SCOPES,
		clientId: "retrospend-mobile",
	},
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

/** A signed cookie for a fresh unscoped (web app) session. */
export async function webCookieFor(userId: string) {
	const token = await sessionFor(userId, {});
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return {
		cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
	};
}

export async function apiKeyFor(userId: string, scopes: string[]) {
	const created = await auth.api.createApiKey({
		body: { userId, name: "test", permissions: { scopes } },
	});
	return created.key;
}

/** Headers for a mobile bearer session of `userId`. */
export async function asMobile(userId: string) {
	return { authorization: `Bearer ${await sessionFor(userId)}` };
}

/** Headers for an API key of `userId` holding exactly `scopes`. */
export async function asKey(userId: string, scopes: string[]) {
	return { "x-api-key": await apiKeyFor(userId, scopes) };
}

/**
 * Turns apiV1Mode on for the file and puts it back afterwards (test files
 * share one database). updateAppSettings' upsert drops the flag columns
 * when it creates the row, so the row is read (created) first.
 */
export function useApiV1() {
	let initial: FeatureFlagMode = "OFF";
	beforeAll(async () => {
		initial = (await getAppSettings()).apiV1Mode;
		await updateAppSettings({ apiV1Mode: "ALL" });
	});
	afterAll(async () => {
		await updateAppSettings({ apiV1Mode: initial });
	});
}

/** Parses a response body with the route's output schema (throws on drift). */
export async function expectBody<T = unknown>(
	res: Response,
	procedure: { "~orpc": { outputSchema?: unknown } },
	status = 200,
): Promise<T> {
	const text = await res.text();
	expect(res.status, text).toBe(status);
	const schema = procedure["~orpc"].outputSchema as
		| { parse: (v: unknown) => unknown }
		| undefined;
	const json = JSON.parse(text) as unknown;
	return (schema ? schema.parse(json) : json) as T;
}

/** Expects a problem+json error with this status and code. */
export async function expectProblem(
	res: Response,
	status: number,
	code: string,
) {
	const text = await res.text();
	expect(res.status, text).toBe(status);
	expect(res.headers.get("content-type")).toBe("application/problem+json");
	expect(JSON.parse(text)).toMatchObject({ status, code });
}

export { adminDb, createTestUser };
