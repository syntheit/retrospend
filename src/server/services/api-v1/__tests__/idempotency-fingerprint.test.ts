import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret" } }));
vi.mock("~/server/db", () => ({ db: {} }));

const { hashRequest, REDACTED, redactSecrets } = await import(
	"../idempotency.service"
);

describe("request fingerprint", () => {
	it("does not depend on a password", async () => {
		const a = await hashRequest("POST", "/me/password", {
			currentPassword: "Old password 1",
			newPassword: "New password 2",
		});
		const b = await hashRequest("POST", "/me/password", {
			currentPassword: "Something else 3",
			newPassword: "Another one 4",
		});
		expect(a).toBe(b);
		const del = (password: string) =>
			hashRequest("POST", "/me/deletion", { password });
		expect(await del("one")).toBe(await del("two"));
	});

	it("still binds the key to the rest of the body", async () => {
		const update = (email: string) =>
			hashRequest("PATCH", "/profile", { email, currentPassword: "x" });
		expect(await update("a@example.com")).not.toBe(
			await update("b@example.com"),
		);
		expect(
			await hashRequest("PATCH", "/profile", { email: "a@example.com" }),
		).not.toBe(await update("a@example.com"));
	});

	it("redacts password fields at any depth and keeps the rest", () => {
		const day = new Date("2026-10-29T00:00:00Z");
		expect(
			redactSecrets({ nested: [{ password: "p", name: "n" }], day }),
		).toEqual({ nested: [{ password: REDACTED, name: "n" }], day });
	});

	it("does not depend on the sign-in secret of an Advanced protection turn-on, and still binds the wraps", async () => {
		const enable = (authKey: string, wrapped: string) =>
			hashRequest("POST", "/me/protection/enable", {
				currentPassword: "Old password 1",
				authKey,
				kdf: { salt: "AAECAwQFBgcICQoLDA0ODw", memoryKiB: 65536, passes: 3 },
				wraps: [{ role: "ak-password", wrapped }],
			});
		const key = "A".repeat(43);
		expect(await enable(key, "wrap-one")).toBe(
			await enable("B".repeat(43), "wrap-one"),
		);
		expect(redactSecrets({ authKey: key })).toEqual({ authKey: REDACTED });
		expect(await enable(key, "wrap-one")).not.toBe(
			await enable(key, "wrap-two"),
		);
	});
});
