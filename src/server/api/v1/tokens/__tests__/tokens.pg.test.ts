/**
 * /api/v1/tokens on Postgres: the web app creates scoped personal access
 * tokens that work at once, no other credential can mint one, no token
 * gets a scope its creator lacks, a replay never shows the key twice, and
 * revoking cuts the key off. RLS keeps users' tokens apart.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const t = contract.tokens;
type Created = {
	token: { id: string; scopes: string[]; expiresAt: string };
	key: string;
};

describe("/api/v1/tokens", () => {
	useApiV1();
	let alice: string;
	let web: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		web = await webCookieFor(alice);
	});

	const create = (
		headers: Record<string, string>,
		body: unknown,
		key?: string,
	) =>
		call("/tokens", { method: "POST", headers, body, idempotent: key ?? true });

	it("creates a scoped token from the web app that works at once", async () => {
		const made = await expectBody<Created>(
			await create(web, {
				name: "Script",
				scopes: ["read"],
				expiresInDays: 30,
			}),
			t.create,
			201,
		);
		expect(made.key.startsWith("rsk_")).toBe(true);
		expect(made.token.scopes).toEqual(["read"]);
		const days =
			(new Date(made.token.expiresAt).getTime() - Date.now()) / 86_400_000;
		expect(Math.round(days)).toBe(30);

		const me = await call("/me", { headers: { "x-api-key": made.key } });
		expect((await me.json()).principal).toMatchObject({
			kind: "apiKey",
			scopes: ["read"],
		});
		await expectProblem(
			await call("/categories", {
				method: "POST",
				headers: { "x-api-key": made.key },
				body: { name: "Nope", color: "teal" },
				idempotent: true,
			}),
			403,
			"missing_scope",
		);
	});

	it("lists tokens without their keys", async () => {
		const res = await call("/tokens", { headers: web });
		const page = await expectBody<{
			items: { name: string; start: string | null }[];
		}>(res, t.list);
		expect(page.items.map((x) => x.name)).toContain("Script");
		expect(page.items.every((x) => !("key" in x))).toBe(true);
	});

	it("is refused to any credential but the web app's session", async () => {
		const mobile = await asMobile(alice);
		await expectProblem(
			await create(mobile, { name: "m", scopes: ["read"] }),
			403,
			"forbidden",
		);
		const key = await asKey(alice, ["read", "write:settings"]);
		await expectProblem(
			await create(key, { name: "k", scopes: ["read"] }),
			403,
			"forbidden",
		);
	});

	it("lists tokens only for the web app's session", async () => {
		const mobile = await asMobile(alice);
		await expectProblem(
			await call("/tokens", { headers: mobile }),
			403,
			"forbidden",
		);
		const key = await asKey(alice, ["read"]);
		await expectProblem(
			await call("/tokens", { headers: key }),
			403,
			"forbidden",
		);
	});

	it("never grants a scope the creator lacks", async () => {
		await expectProblem(
			await create(web, { name: "a", scopes: ["admin"] }),
			403,
			"forbidden",
		);
		const admin = await webCookieFor(
			(await createTestUser({ role: "ADMIN" })).user.id,
		);
		const made = await expectBody<Created>(
			await create(admin, { name: "ops", scopes: ["read", "admin"] }),
			t.create,
			201,
		);
		expect(made.token.scopes).toEqual(["read", "admin"]);
	});

	it("never shows a key twice: a replay is replay_unavailable", async () => {
		const user = (await createTestUser()).user.id;
		const cookie = await webCookieFor(user);
		const key = randomUUID();
		const body = { name: "Once", scopes: ["read"] };
		await expectBody(await create(cookie, body, key), t.create, 201);
		await expectProblem(
			await create(cookie, body, key),
			409,
			"idempotency_replay_unavailable",
		);
		await expect(
			adminDb.apikey.count({ where: { referenceId: user } }),
		).resolves.toBe(1);
	});

	it("revokes a token, which cuts its key off, and keeps users apart (RLS)", async () => {
		const made = await expectBody<Created>(
			await create(web, { name: "Short", scopes: ["read"] }),
			t.create,
			201,
		);
		const bob = await webCookieFor((await createTestUser()).user.id);
		await expectProblem(
			await call(`/tokens/${made.token.id}`, {
				method: "DELETE",
				headers: bob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		const bobsList = await expectBody<{ items: unknown[] }>(
			await call("/tokens", { headers: bob }),
			t.list,
		);
		expect(bobsList.items).toEqual([]);

		await expectBody(
			await call(`/tokens/${made.token.id}`, {
				method: "DELETE",
				headers: web,
				idempotent: true,
			}),
			t.revoke,
		);
		await expectProblem(
			await call("/me", { headers: { "x-api-key": made.key } }),
			401,
			"unauthenticated",
		);
	});
});
