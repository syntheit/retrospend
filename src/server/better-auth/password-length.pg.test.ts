/**
 * The longest password the change and reset routes accept (255) must also
 * sign in: better-auth's own default limit is 128, so without the contract's
 * limits in its config a 129 to 255 character password is saved and then can
 * never sign in.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { PASSWORD_MAX_LENGTH } from "@retrospend/api-contract";
import { describe, expect, it, vi } from "vitest";
import {
	call,
	expectProblem,
	sessionFor,
} from "~/server/api/v1/core/__tests__/harness";
import { auth } from "~/server/better-auth";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BASE = new URL(auth.options.baseURL ?? "http://localhost:1997").origin;
const FIRST = "Correct horse 1";
const long = (length: number) => `Aa1${"x".repeat(length - 3)}`;

async function account() {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: FIRST,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	return { id: user.id, email };
}

const signIn = (email: string, password: string) =>
	auth.handler(
		new Request(`${BASE}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { origin: BASE, "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
		}),
	);

describe("the password length limit at sign-in", () => {
	for (const length of [129, 200, PASSWORD_MAX_LENGTH]) {
		it(`signs in with a ${length} character password set through the change route`, async () => {
			const a = await account();
			const next = long(length);
			const changed = await call("/me/password", {
				method: "POST",
				headers: {
					authorization: `Bearer ${await sessionFor(a.id)}`,
					"x-forwarded-for": "198.51.100.88",
				},
				body: { currentPassword: FIRST, newPassword: next },
				idempotent: true,
			});
			expect(changed.status).toBe(200);
			expect((await signIn(a.email, next)).status).toBe(200);
			expect((await signIn(a.email, FIRST)).status).toBe(401);
		});
	}

	it("refuses a password over 255 characters at the change route", async () => {
		const a = await account();
		const res = await call("/me/password", {
			method: "POST",
			headers: {
				authorization: `Bearer ${await sessionFor(a.id)}`,
				"x-forwarded-for": "198.51.100.89",
			},
			body: {
				currentPassword: FIRST,
				newPassword: long(PASSWORD_MAX_LENGTH + 1),
			},
			idempotent: true,
		});
		await expectProblem(res, 400, "validation_failed");
	});
});
