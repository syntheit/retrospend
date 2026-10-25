/**
 * The security review's escalation scenario, kept as a permanent test: a
 * scoped token (device authorization "read", or the mobile app's session)
 * held by an admin must stay inside its scopes everywhere, not only on
 * /api/v1. It must not become a full web session in tRPC, approve devices,
 * mint API keys or use other auth endpoints, as a bearer or as a cookie.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/better-auth";
import { adminDb } from "~/test/pg-harness";
import { handleV1Request } from "../handler";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BASE = new URL(auth.options.baseURL ?? "http://localhost:1997").origin;
const PASSWORD = "correct horse battery";
const createCaller = createCallerFactory(appRouter);

function authRequest(
	path: string,
	init: {
		method?: string;
		headers?: Record<string, string>;
		body?: unknown;
	} = {},
) {
	return auth.handler(
		new Request(`${BASE}/api/auth${path}`, {
			method: init.method ?? "POST",
			headers: {
				origin: BASE,
				...(init.body === undefined
					? {}
					: { "content-type": "application/json" }),
				...init.headers,
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}),
	);
}

/** The cookie header better-auth expects for a session token. */
async function cookieFor(token: string) {
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function passwordUser(role: "USER" | "ADMIN") {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: PASSWORD,
			name: "Escalation",
			username: `e${randomBytes(6).toString("hex")}`,
		},
	});
	await adminDb.user.update({ where: { id: user.id }, data: { role } });
	return { id: user.id, email };
}

async function signIn(email: string, headers: Record<string, string> = {}) {
	const res = await authRequest("/sign-in/email", {
		body: { email, password: PASSWORD },
		headers,
	});
	expect(res.status).toBe(200);
	const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	return { res, cookie };
}

async function deviceSession(userId: string, scopes: string) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date(Date.now() + 86_400_000),
			scopes,
			clientId: "retrospend-cli",
		},
	});
	return token;
}

describe("scoped tokens cannot escalate", () => {
	let admin: { id: string; email: string };
	let deviceToken: string;
	let asBearer: Record<string, string>;
	let asCookie: Record<string, string>;

	beforeAll(async () => {
		admin = await passwordUser("ADMIN");
		deviceToken = await deviceSession(admin.id, "read");
		asBearer = { authorization: `Bearer ${deviceToken}` };
		asCookie = { cookie: await cookieFor(deviceToken) };
	});

	it("the signed cookie helper produces a cookie better-auth accepts", async () => {
		const res = await authRequest("/get-session", {
			method: "GET",
			headers: asCookie,
		});
		expect((await res.json())?.session?.token).toBe(deviceToken);
	});

	it("never becomes a tRPC session, as a bearer or a cookie", async () => {
		for (const headers of [asBearer, asCookie]) {
			const ctx = await createTRPCContext({ headers: new Headers(headers) });
			expect(ctx.session).toBeNull();
			await expect(createCaller(ctx).admin.getStats()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
		}
	});

	it("cannot claim or approve a device code asking for admin", async () => {
		const code = await auth.api.deviceCode({
			body: { client_id: "retrospend-cli", scope: "read admin" },
		});
		for (const headers of [asBearer, asCookie]) {
			const claim = await authRequest(`/device?user_code=${code.user_code}`, {
				method: "GET",
				headers,
			});
			expect(claim.status).toBe(403);
			const approve = await authRequest("/device/approve", {
				body: { userCode: code.user_code },
				headers,
			});
			expect(approve.status).toBe(403);
		}
		const row = await adminDb.deviceCode.findFirstOrThrow({
			where: { userCode: code.user_code },
		});
		expect(row).toMatchObject({ status: "pending", userId: null });
	});

	it("cannot mint an API key that outlives it", async () => {
		for (const headers of [asBearer, asCookie]) {
			const res = await authRequest("/api-key/create", {
				body: { name: "escalate", expiresIn: 365 * 86_400 },
				headers,
			});
			expect(res.status).toBe(403);
		}
		await expect(
			adminDb.apikey.count({ where: { referenceId: admin.id } }),
		).resolves.toBe(0);
	});

	it("cannot use other auth endpoints", async () => {
		for (const headers of [asBearer, asCookie]) {
			const res = await authRequest("/update-user", {
				body: { name: "Hijacked" },
				headers,
			});
			expect(res.status).toBe(403);
		}
		const user = await adminDb.user.findUniqueOrThrow({
			where: { id: admin.id },
		});
		expect(user.name).toBe("Escalation");
	});

	it("stamps the mobile app's session with the mobile scopes, on any transport", async () => {
		const { res, cookie } = await signIn(admin.email, {
			"expo-origin": "retrospend://",
		});
		expect(res.headers.get("set-auth-token")).toBeTruthy();
		const row = await adminDb.session.findFirstOrThrow({
			where: { userId: admin.id, clientId: "retrospend-mobile" },
		});
		expect(row.scopes).toBe("read write:expenses write:money write:settings");

		const me = await handleV1Request(
			new Request(`${BASE}/api/v1/me`, { headers: { cookie } }),
		);
		expect(me.status).toBe(200);
		expect((await me.json()).principal).toMatchObject({
			kind: "mobile",
			scopes: ["read", "write:expenses", "write:money", "write:settings"],
		});

		const ctx = await createTRPCContext({ headers: new Headers({ cookie }) });
		expect(ctx.session).toBeNull();
	});

	it("keeps the web session token away from page scripts", async () => {
		const { res, cookie } = await signIn(admin.email);
		expect(res.headers.get("set-auth-token")).toBeNull();
		const ctx = await createTRPCContext({ headers: new Headers({ cookie }) });
		expect(ctx.session?.user.id).toBe(admin.id);
	});

	it("approves devices only from the web app, capped to the approver", async () => {
		const user = await passwordUser("USER");
		const { cookie } = await signIn(user.email);
		const code = await auth.api.deviceCode({
			body: { client_id: "retrospend-cli", scope: "read admin" },
		});
		const web = { cookie };
		expect(
			(
				await authRequest(`/device?user_code=${code.user_code}`, {
					method: "GET",
					headers: web,
				})
			).status,
		).toBe(200);
		expect(
			(
				await authRequest("/device/approve", {
					body: { userCode: code.user_code },
					headers: web,
				})
			).status,
		).toBe(200);

		const token = await authRequest("/device/token", {
			body: {
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: code.device_code,
				client_id: "retrospend-cli",
			},
		});
		expect(token.status).toBe(200);
		const body = await token.json();
		expect(body.scope).toBe("read");
		const row = await adminDb.session.findUniqueOrThrow({
			where: { token: body.access_token },
		});
		expect(row).toMatchObject({ scopes: "read", clientId: "retrospend-cli" });

		const me = await handleV1Request(
			new Request(`${BASE}/api/v1/me`, {
				headers: { authorization: `Bearer ${body.access_token}` },
			}),
		);
		expect((await me.json()).principal).toMatchObject({
			kind: "device",
			scopes: ["read"],
			clientId: "retrospend-cli",
		});
	});

	it("refuses an oversized scope list without a server error", async () => {
		const res = await authRequest("/device/code", {
			body: { client_id: "retrospend-cli", scope: "read ".repeat(100) },
		});
		expect(res.status).toBe(400);
	});
});

/** A session whose daily refresh is due (60-day life, refreshed after a day). */
async function sessionDueForRefresh(
	userId: string,
	stamp: { scopes?: string; clientId?: string } = {},
) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date(Date.now() + 58 * 86_400_000),
			...stamp,
		},
	});
	return token;
}

describe("a bad bearer never falls back to a scoped cookie", () => {
	let user: { id: string; email: string };
	let cookie: string;

	beforeAll(async () => {
		user = await passwordUser("ADMIN");
		const deviceToken = await deviceSession(user.id, "read");
		cookie = await cookieFor(deviceToken);
	});

	it("refuses a bad or foreign Authorization header next to the cookie", async () => {
		for (const authorization of [
			"Bearer junk.badsig",
			"Bearer junk",
			"Basic dXNlcjpwYXNz",
		]) {
			const headers = { authorization, cookie };
			const sessions = await authRequest("/list-sessions", {
				method: "GET",
				headers,
			});
			expect(sessions.status).not.toBe(200);
			const update = await authRequest("/update-user", {
				body: { name: "Hijacked" },
				headers,
			});
			expect(update.status).not.toBe(200);
		}
		const row = await adminDb.user.findUniqueOrThrow({
			where: { id: user.id },
		});
		expect(row.name).toBe("Escalation");
	});

	it("never hands a scoped session a cookie on refresh", async () => {
		const token = await sessionDueForRefresh(user.id, {
			scopes: "read",
			clientId: "retrospend-cli",
		});
		const res = await authRequest("/get-session", {
			method: "GET",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		expect((await res.json())?.session?.token).toBe(token);
		expect(res.headers.get("set-cookie")).toBeNull();
		expect(res.headers.get("set-auth-token")).toBeNull();
	});

	it("hands the token to scripts only for mobile sessions, whatever the headers", async () => {
		const token = await sessionDueForRefresh(user.id);
		const res = await authRequest("/get-session", {
			method: "GET",
			headers: {
				cookie: await cookieFor(token),
				"expo-origin": "retrospend://",
			},
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("set-auth-token")).toBeNull();
	});
});

/** The signed cookie value for a token, without the cookie name. */
async function signedValue(token: string) {
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return encodeURIComponent(`${token}.${signature}`);
}

describe("the guard reads cookies and bearers exactly as better-auth does", () => {
	let user: { id: string; email: string };
	let scopedToken: string;

	beforeAll(async () => {
		user = await passwordUser("ADMIN");
		scopedToken = await deviceSession(user.id, "read");
	});

	const cookieForms = (value: string) => [
		`better-auth.session_token="${value}"`,
		`better-auth.session_token = ${value}`,
		`better-auth.session_token= "${value}" `,
	];

	it("refuses a scoped session in every cookie form better-auth accepts", async () => {
		for (const cookie of cookieForms(await signedValue(scopedToken))) {
			// Control: better-auth resolves this form to the scoped session.
			const session = await authRequest("/get-session", {
				method: "GET",
				headers: { cookie },
			});
			expect((await session.json())?.session?.token).toBe(scopedToken);

			const list = await authRequest("/list-sessions", {
				method: "GET",
				headers: { cookie },
			});
			expect(list.status).toBe(403);
		}
	});

	it("treats Bearer with a tab as no bearer, as the bearer plugin does", async () => {
		const alone = await authRequest("/list-sessions", {
			method: "GET",
			headers: { authorization: `Bearer\t${scopedToken}` },
		});
		expect(alone.status).not.toBe(200);
		const withCookie = await authRequest("/list-sessions", {
			method: "GET",
			headers: {
				authorization: "Bearer\tjunk",
				cookie: `better-auth.session_token=${await signedValue(scopedToken)}`,
			},
		});
		expect(withCookie.status).toBe(403);
	});

	it("never turns a bearer into a web cookie on refresh", async () => {
		// A web token copied out of a browser and sent as a bearer must not
		// come back as a fresh signed web cookie.
		const webToken = await sessionDueForRefresh(user.id);
		const res = await authRequest("/get-session", {
			method: "GET",
			headers: { authorization: `Bearer ${webToken}` },
		});
		expect(res.headers.get("set-cookie")).toBeNull();
		expect(res.headers.get("set-auth-token")).toBeNull();
	});

	it("never falls back to a web cookie behind a bad-signature bearer", async () => {
		const webToken = await sessionDueForRefresh(user.id);
		const list = await authRequest("/list-sessions", {
			method: "GET",
			headers: {
				authorization: "Bearer junk.badsig",
				cookie: `better-auth.session_token=${await signedValue(webToken)}`,
			},
		});
		expect(list.status).toBe(401);
	});

	it("keeps a web session working next to a Basic Authorization header", async () => {
		const webToken = await sessionDueForRefresh(user.id);
		const headers = {
			cookie: `better-auth.session_token=${await signedValue(webToken)}`,
			authorization: "Basic dXNlcjpwYXNz",
		};
		const list = await authRequest("/list-sessions", {
			method: "GET",
			headers,
		});
		expect(list.status).toBe(200);
		const ctx = await createTRPCContext({ headers: new Headers(headers) });
		expect(ctx.session?.user.id).toBe(user.id);
	});
});
