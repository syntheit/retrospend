/**
 * Settings' approved devices: listed and disconnected by session id for a
 * plain web session of any age (better-auth's listSessions refused one
 * older than a day), never handing a token to the page.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/better-auth";
import { adminDb, createTestUser } from "~/test/pg-harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BASE = new URL(auth.options.baseURL ?? "http://localhost:1997").origin;
const PASSWORD = "correct horse battery";
const DAY = 86_400_000;
const createCaller = createCallerFactory(appRouter);

async function cookieFor(token: string) {
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function session(
	userId: string,
	opts: { clientId?: string; scopes?: string; expiresIn?: number } = {},
) {
	const row = await adminDb.session.create({
		data: {
			id: randomUUID(),
			token: randomBytes(24).toString("hex"),
			userId,
			expiresAt: new Date(Date.now() + (opts.expiresIn ?? DAY)),
			scopes: opts.scopes ?? null,
			clientId: opts.clientId ?? null,
		},
	});
	return row;
}

describe("deviceSession router", () => {
	let userId: string;
	let webToken: string;
	let webId: string;
	let cli: { id: string; token: string };
	let otherDevice: { id: string };
	let caller: ReturnType<typeof createCaller>;

	beforeAll(async () => {
		const email = `${randomUUID()}@pg-test.invalid`;
		const { user } = await auth.api.signUpEmail({
			body: {
				email,
				password: PASSWORD,
				name: "Devices",
				username: `d${randomBytes(6).toString("hex")}`,
			},
		});
		userId = user.id;
		const res = await auth.handler(
			new Request(`${BASE}/api/auth/sign-in/email`, {
				method: "POST",
				headers: { origin: BASE, "content-type": "application/json" },
				body: JSON.stringify({ email, password: PASSWORD }),
			}),
		);
		expect(res.status).toBe(200);
		const web = await adminDb.session.findFirstOrThrow({
			where: { userId, clientId: null },
		});
		webToken = web.token;
		webId = web.id;
		// Signed in two days ago: not "fresh" for better-auth's session list.
		const twoDaysAgo = new Date(Date.now() - 2 * DAY);
		await adminDb.session.update({
			where: { id: webId },
			data: { createdAt: twoDaysAgo, updatedAt: twoDaysAgo },
		});

		cli = await session(userId, {
			clientId: "retrospend-cli",
			scopes: "read write:expenses",
		});
		await session(userId, {
			clientId: "retrospend-mcp",
			scopes: "read",
			expiresIn: -DAY,
		});
		await session(userId, {
			clientId: "retrospend-mobile",
			scopes: "read write:expenses write:money write:settings",
		});
		const other = await createTestUser();
		otherDevice = await session(other.user.id, {
			clientId: "retrospend-desktop",
			scopes: "read",
		});

		const ctx = await createTRPCContext({
			headers: new Headers({ cookie: await cookieFor(webToken) }),
		});
		expect(ctx.session?.user.id).toBe(userId);
		caller = createCaller(ctx);
	});

	it("lists only the user's live device sessions, without tokens", async () => {
		const list = await caller.deviceSession.list();
		expect(list).toEqual([
			{
				id: cli.id,
				clientId: "retrospend-cli",
				scopes: ["read", "write:expenses"],
				approvedAt: expect.any(Date),
				lastUsedAt: expect.any(Date),
			},
		]);
		const json = JSON.stringify(list);
		expect(json).not.toContain(cli.token);
		expect(json).not.toContain(webToken);
	});

	it("does not disconnect the web session or another user's device", async () => {
		await expect(
			caller.deviceSession.disconnect({ id: webId }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			caller.deviceSession.disconnect({ id: otherDevice.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			adminDb.session.count({ where: { id: { in: [webId, otherDevice.id] } } }),
		).resolves.toBe(2);
	});

	it("disconnects a device by id, and its token stops working", async () => {
		await expect(
			caller.deviceSession.disconnect({ id: cli.id }),
		).resolves.toEqual({ id: cli.id });
		await expect(
			adminDb.session.findUnique({ where: { id: cli.id } }),
		).resolves.toBeNull();
		const after = await auth.api.getSession({
			headers: new Headers({ authorization: `Bearer ${cli.token}` }),
		});
		expect(after).toBeNull();
		await expect(caller.deviceSession.list()).resolves.toEqual([]);
	});
});
