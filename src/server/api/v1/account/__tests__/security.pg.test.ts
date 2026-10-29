/**
 * /api/v1/me/password and /me/sessions on Postgres: only the person's own
 * sign-in may use them, the current password every time with a tries limit,
 * the other sessions signed out on a change, and sessions listed and ended
 * without a token ever leaving the server.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract, SCOPES } from "@retrospend/api-contract";
import { verifyPassword } from "better-auth/crypto";
import { describe, expect, it, vi } from "vitest";
import { auth } from "~/server/better-auth";
import {
	adminDb,
	apiKeyFor,
	call,
	expectBody,
	expectProblem,
	sessionFor,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const a = contract.account;
const PASSWORD = "Correct horse 1";
const NEW_PASSWORD = "Battery staple 2";

async function passwordUser() {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	return user.id;
}

/** A mobile bearer and the id of its session. */
async function mobile(userId: string) {
	const token = await sessionFor(userId);
	const row = await adminDb.session.findUniqueOrThrow({ where: { token } });
	return { headers: { authorization: `Bearer ${token}` }, id: row.id, token };
}

const storedHash = async (userId: string) =>
	(
		await adminDb.account.findFirstOrThrow({
			where: { userId, providerId: "credential" },
		})
	).password ?? "";

const sessionExists = async (token: string) =>
	(await adminDb.session.findUnique({ where: { token } })) !== null;

// Each caller has its own address, so the per-IP limit of other files never matters.
let n = 0;
const ip = () => ({ "x-forwarded-for": `198.51.100.${10 + (n++ % 180)}` });

const changePassword = (headers: Record<string, string>, body: unknown) =>
	call("/me/password", {
		method: "POST",
		headers: { ...ip(), ...headers },
		body,
		idempotent: true,
	});

describe("/api/v1/me/password", () => {
	it("changes the password and signs out every other session", async () => {
		const id = await passwordUser();
		const me = await mobile(id);
		const other = await sessionFor(id);
		const web = await sessionFor(id, {});
		const result = await expectBody<{ signedOut: number }>(
			await changePassword(me.headers, {
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
			}),
			a.changePassword,
		);
		expect(result.signedOut).toBeGreaterThanOrEqual(2);
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(id),
			}),
		).toBe(true);
		expect(await sessionExists(me.token)).toBe(true);
		expect(await sessionExists(other)).toBe(false);
		expect(await sessionExists(web)).toBe(false);
	});

	it("refuses a wrong current password and changes nothing", async () => {
		const id = await passwordUser();
		const me = await mobile(id);
		const other = await sessionFor(id);
		const before = await storedHash(id);
		const res = await changePassword(me.headers, {
			currentPassword: "Not my password 1",
			newPassword: NEW_PASSWORD,
		});
		await expectProblem(res, 400, "bad_request");
		expect(await storedHash(id)).toBe(before);
		expect(await sessionExists(other)).toBe(true);
	});

	it("holds a new password to the rule", async () => {
		const id = await passwordUser();
		const me = await mobile(id);
		for (const newPassword of ["short1A", "alllowercase1", "NoNumbersHere"]) {
			const res = await changePassword(me.headers, {
				currentPassword: PASSWORD,
				newPassword,
			});
			expect(res.status, newPassword).toBe(400);
		}
	});

	it("stops after 5 wrong tries with a 429 and Retry-After", async () => {
		const id = await passwordUser();
		const me = await mobile(id);
		const wrong = {
			currentPassword: "Wrong guess 1",
			newPassword: NEW_PASSWORD,
		};
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await changePassword(me.headers, wrong),
				400,
				"bad_request",
			);
		const limited = await changePassword(me.headers, {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
		});
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		await expectProblem(limited, 429, "rate_limited");
		expect(
			await verifyPassword({ password: PASSWORD, hash: await storedHash(id) }),
		).toBe(true);
	});

	it("counts tries per session, so one session cannot lock out another", async () => {
		const id = await passwordUser();
		const stolen = await mobile(id);
		const owner = await mobile(id);
		const wrong = {
			currentPassword: "Wrong guess 1",
			newPassword: NEW_PASSWORD,
		};
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await changePassword(stolen.headers, wrong),
				400,
				"bad_request",
			);
		await expectProblem(
			await changePassword(stolen.headers, wrong),
			429,
			"rate_limited",
		);
		await expectBody(
			await changePassword(owner.headers, {
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
			}),
			a.changePassword,
		);
		// The change signed the stolen session out.
		expect(await sessionExists(stolen.token)).toBe(false);
	});

	it("refuses every credential that is not the person's own sign-in", async () => {
		const id = await passwordUser();
		const body = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
		const every = SCOPES.filter((s) => s !== "admin");
		await expectProblem(
			await changePassword(
				{ "x-api-key": await apiKeyFor(id, [...every, "account:security"]) },
				body,
			),
			403,
			"missing_scope",
		);
		const device = await sessionFor(id, {
			scopes: [...every, "account:security"].join(" "),
			clientId: "retrospend-cli",
		});
		await expectProblem(
			await changePassword({ authorization: `Bearer ${device}` }, body),
			403,
			"missing_scope",
		);
		const narrowed = await sessionFor(id, {
			scopes: "read write:money",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await changePassword({ authorization: `Bearer ${narrowed}` }, body),
			403,
			"missing_scope",
		);
		await expectProblem(await changePassword({}, body), 401, "unauthenticated");
		expect(
			await verifyPassword({ password: PASSWORD, hash: await storedHash(id) }),
		).toBe(true);
	});

	it("lets the web app's own session change it too", async () => {
		const id = await passwordUser();
		await expectBody(
			await changePassword(await webCookieFor(id), {
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
			}),
			a.changePassword,
		);
	});
});

describe("/api/v1/me/sessions", () => {
	it("lists the caller's live sessions with the current one marked, no tokens", async () => {
		const id = await passwordUser();
		const stranger = await passwordUser();
		const me = await mobile(id);
		const web = await sessionFor(id, {});
		const device = await sessionFor(id, {
			scopes: "read",
			clientId: "retrospend-cli",
		});
		const expired = randomBytes(24).toString("hex");
		await adminDb.session.create({
			data: {
				id: randomUUID(),
				token: expired,
				userId: id,
				expiresAt: new Date(Date.now() - 1000),
			},
		});
		await sessionFor(stranger);

		const res = await call("/me/sessions", {
			headers: { ...ip(), ...me.headers },
		});
		const text = await res.clone().text();
		const list = await expectBody<{
			items: {
				id: string;
				kind: string;
				current: boolean;
				clientId: string | null;
			}[];
		}>(res, a.sessions);
		for (const token of [me.token, web, device, expired])
			expect(text).not.toContain(token);
		const ids = list.items.map((s) => s.id);
		const rows = await adminDb.session.findMany({
			where: { userId: id, expiresAt: { gt: new Date() } },
			select: { id: true },
		});
		expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.id)));
		expect(list.items.filter((s) => s.current).map((s) => s.id)).toEqual([
			me.id,
		]);
		expect(list.items.find((s) => s.id === me.id)?.kind).toBe("mobile");
		expect(list.items.find((s) => s.clientId === "retrospend-cli")?.kind).toBe(
			"device",
		);
		expect(list.items.some((s) => s.kind === "web")).toBe(true);
	});

	it("signs out another session, and only the caller's own", async () => {
		const id = await passwordUser();
		const stranger = await passwordUser();
		const me = await mobile(id);
		const other = await sessionFor(id, {});
		const otherRow = await adminDb.session.findUniqueOrThrow({
			where: { token: other },
		});
		const theirs = await mobile(stranger);

		const end = (sessionId: string) =>
			call(`/me/sessions/${sessionId}`, {
				method: "DELETE",
				headers: { ...ip(), ...me.headers },
				idempotent: true,
			});

		await expectBody(await end(otherRow.id), a.endSession);
		expect(await sessionExists(other)).toBe(false);

		await expectProblem(await end(theirs.id), 404, "not_found");
		expect(await sessionExists(theirs.token)).toBe(true);

		await expectProblem(await end(me.id), 400, "bad_request");
		expect(await sessionExists(me.token)).toBe(true);
	});

	it("is closed to API keys and device sessions", async () => {
		const id = await passwordUser();
		const every = SCOPES.filter((s) => s !== "admin");
		const key = await apiKeyFor(id, [...every]);
		await expectProblem(
			await call("/me/sessions", { headers: { ...ip(), "x-api-key": key } }),
			403,
			"missing_scope",
		);
		const device = await sessionFor(id, {
			scopes: every.join(" "),
			clientId: "retrospend-cli",
		});
		await expectProblem(
			await call("/me/sessions", {
				headers: { ...ip(), authorization: `Bearer ${device}` },
			}),
			403,
			"missing_scope",
		);
	});
});
