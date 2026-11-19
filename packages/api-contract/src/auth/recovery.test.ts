import { describe, expect, it } from "vitest";
import { listContractRoutes } from "../common/meta";
import { RECOVERY_WRAP_ROLES } from "../keys";
import {
	authContract,
	beginRecoveryResultSchema,
	beginRecoverySchema,
	checkRecoverySchema,
	recoverSchema,
} from "./index";

const b64 = (n: number) => "A".repeat(n);
const KEY = b64(43);
const KDF = { salt: b64(22), memoryKiB: 65_536, passes: 3 };
const recover = (over: Record<string, unknown> = {}) => ({
	token: "a".repeat(64),
	recoveryAuthKey: KEY,
	newAuthKey: KEY,
	kdf: KDF,
	wrappedAccountKey: b64(100),
	baseVersion: 1,
	...over,
});
const ok = (
	schema: { safeParse: (v: unknown) => { success: boolean } },
	v: unknown,
) => schema.safeParse(v).success;

describe("the recovery routes", () => {
	const routes = listContractRoutes({ auth: authContract }).filter((r) =>
		r.path?.startsWith("/auth/recovery"),
	);
	const byPath = Object.fromEntries(routes.map((r) => [r.path, r.meta]));

	it("are three public POSTs", () => {
		expect(Object.keys(byPath).sort()).toEqual([
			"/auth/recovery",
			"/auth/recovery/begin",
			"/auth/recovery/check",
		]);
		for (const r of routes) {
			expect(r.method, r.path).toBe("POST");
			expect(r.meta.scope, r.path).toBe("public");
			expect(r.meta.event, r.path).toBeUndefined();
		}
	});

	it("check and begin only read; the commit is a publicWrite proved by the token", () => {
		expect(byPath["/auth/recovery/check"]?.readsOnly).toBe(true);
		expect(byPath["/auth/recovery/begin"]?.readsOnly).toBe(true);
		expect(byPath["/auth/recovery"]?.publicWrite).toBe("resetToken");
		expect(byPath["/auth/recovery"]?.readsOnly).toBeUndefined();
	});
});

describe("the recovery bodies", () => {
	it("take a token of any shape up to 256 characters, so a garbage token is a 404 and not a format hint", () => {
		expect(ok(checkRecoverySchema, { token: "x" })).toBe(true);
		expect(ok(checkRecoverySchema, { token: "x".repeat(256) })).toBe(true);
		expect(ok(checkRecoverySchema, { token: "" })).toBe(false);
		expect(ok(checkRecoverySchema, { token: "x".repeat(257) })).toBe(false);
	});

	it("take the recovery proof as exactly 43 characters of base64url", () => {
		const begin = (recoveryAuthKey: string) => ({
			token: "t",
			recoveryAuthKey,
		});
		expect(ok(beginRecoverySchema, begin(KEY))).toBe(true);
		for (const bad of [b64(42), b64(44), `${b64(42)}=`, `${b64(42)}+`])
			expect(ok(beginRecoverySchema, begin(bad))).toBe(false);
	});

	it("takes the commit fields at their bounds", () => {
		expect(ok(recoverSchema, recover())).toBe(true);
		for (const field of ["recoveryAuthKey", "newAuthKey"])
			for (const length of [42, 44])
				expect(ok(recoverSchema, recover({ [field]: b64(length) }))).toBe(
					false,
				);
		expect(ok(recoverSchema, recover({ wrappedAccountKey: "" }))).toBe(false);
		expect(ok(recoverSchema, recover({ wrappedAccountKey: b64(513) }))).toBe(
			false,
		);
		expect(ok(recoverSchema, recover({ baseVersion: 0 }))).toBe(false);
		expect(ok(recoverSchema, recover({ baseVersion: 1.5 }))).toBe(false);
		expect(ok(recoverSchema, recover({ kdf: { ...KDF, passes: 0 } }))).toBe(
			false,
		);
	});
});

describe("the begin answer", () => {
	const answer = (role: string) => ({
		userId: "user_1",
		version: 1,
		publicKey: KEY,
		wraps: [{ role, targetId: "user_1", wrapped: b64(100) }],
	});

	it("can name only the roles the recovery key opens", () => {
		expect([...RECOVERY_WRAP_ROLES]).toEqual(["ak-recovery", "private-key"]);
		for (const role of RECOVERY_WRAP_ROLES)
			expect(ok(beginRecoveryResultSchema, answer(role))).toBe(true);
		for (const role of [
			"ak-password",
			"collection-key",
			"ak-device",
			"ak-contact",
		])
			expect(ok(beginRecoveryResultSchema, answer(role))).toBe(false);
	});
});
