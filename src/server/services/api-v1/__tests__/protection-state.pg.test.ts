/**
 * The protection state column: OFF for everyone, written on the owner
 * connection only, never granted to the app role, never settable through
 * better-auth, and carried by the principal the access guard reads.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { adminDb } from "~/test/pg-harness";
import { resolvePrincipal } from "../principal.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BASE = new URL(auth.options.baseURL ?? "http://localhost:1997").origin;
const PASSWORD = "correct horse battery";

let client: Client;
beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});
afterAll(async () => {
	await client.end();
});

async function passwordUser() {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Protected",
			username: `p${randomBytes(6).toString("hex")}`,
		},
	});
	return user.id;
}

/** A session cookie for the user, signed the way better-auth reads it. */
async function cookieFor(userId: string) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date(Date.now() + 86_400_000),
		},
	});
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const stored = async (userId: string) =>
	(await adminDb.user.findUniqueOrThrow({ where: { id: userId } }))
		.protectionState;

/** Runs `sql` as the app role signed in as `userId`; the SQLSTATE or "ok". */
async function asApp(userId: string, sql: string): Promise<string> {
	await client.query("BEGIN");
	try {
		await client.query("SELECT set_config('app.current_user_id', $1, true)", [
			userId,
		]);
		await client.query("SET LOCAL ROLE retrospend_app");
		await client.query(sql);
		return "ok";
	} catch (error) {
		return (error as { code?: string }).code ?? "error";
	} finally {
		await client.query("ROLLBACK");
	}
}

describe("the protection state column", () => {
	it("is OFF for a new user", async () => {
		const id = await passwordUser();
		expect(await stored(id)).toBe("OFF");
	});

	it("is neither readable nor writable by the app role", async () => {
		const id = await passwordUser();
		expect(await asApp(id, 'SELECT "protectionState" FROM "user"')).toBe(
			"42501",
		);
		expect(await asApp(id, `UPDATE "user" SET "protectionState" = 'ON'`)).toBe(
			"42501",
		);
		// A column the app role may read still reads, so the refusals above are
		// about this column and not about the table or the role setup.
		expect(await asApp(id, 'SELECT "role" FROM "user"')).toBe("ok");
	});

	it("is reported by the principal: false for OFF, true after an owner update to ON", async () => {
		const id = await passwordUser();
		const headers = new Headers({ cookie: await cookieFor(id) });
		const before = await resolvePrincipal(headers);
		expect(before.ok && before.principal.protected).toBe(false);

		await client.query(
			`UPDATE "user" SET "protectionState" = 'ON' WHERE "id" = $1`,
			[id],
		);
		const after = await resolvePrincipal(headers);
		expect(after.ok && after.principal.protected).toBe(true);
	});

	it("is reported on the API key path", async () => {
		const id = await passwordUser();
		const { key } = await auth.api.createApiKey({
			body: { userId: id, name: "state test" },
		});
		const headers = new Headers({ "x-api-key": key });
		const before = await resolvePrincipal(headers);
		expect(before.ok && before.principal.protected).toBe(false);

		await client.query(
			`UPDATE "user" SET "protectionState" = 'ON' WHERE "id" = $1`,
			[id],
		);
		const after = await resolvePrincipal(headers);
		expect(after.ok && after.principal.protected).toBe(true);
	});

	it("cannot be set at sign-up or by updateUser", async () => {
		await expect(
			auth.api.signUpEmail({
				body: {
					email: `${randomUUID()}@pg-test.invalid`,
					password: PASSWORD,
					name: "Sneaky",
					username: `s${randomBytes(6).toString("hex")}`,
					protectionState: "ON",
				} as never,
			}),
		).rejects.toThrow();

		const id = await passwordUser();
		const res = await auth.handler(
			new Request(`${BASE}/api/auth/update-user`, {
				method: "POST",
				headers: {
					origin: BASE,
					"content-type": "application/json",
					cookie: await cookieFor(id),
				},
				body: JSON.stringify({ name: "Renamed", protectionState: "ON" }),
			}),
		);
		expect(res.status).toBe(400);
		expect(await stored(id)).toBe("OFF");
	});
});
