import { describe, expect, it } from "vitest";
import { listContractRoutes } from "../common/meta";
import {
	authContract,
	redeemResetCodeResultSchema,
	redeemResetCodeSchema,
	requestResetCodeResultSchema,
	requestResetCodeSchema,
} from "./index";

const ok = (
	schema: { safeParse: (v: unknown) => { success: boolean } },
	v: unknown,
) => schema.safeParse(v).success;

describe("the phone reset routes", () => {
	const routes = listContractRoutes({ auth: authContract }).filter((r) =>
		r.path?.startsWith("/auth/password-reset"),
	);
	const byPath = Object.fromEntries(routes.map((r) => [r.path, r.meta]));

	it("are two public POSTs that write: the request has no token yet, the redeem is proved by the code", () => {
		expect(Object.keys(byPath).sort()).toEqual([
			"/auth/password-reset",
			"/auth/password-reset/code",
		]);
		for (const r of routes) {
			expect(r.method, r.path).toBe("POST");
			expect(r.meta.scope, r.path).toBe("public");
			expect(r.meta.readsOnly, r.path).toBeUndefined();
			expect(r.meta.event, r.path).toBeUndefined();
		}
		expect(byPath["/auth/password-reset"]?.publicWrite).toBe("resetRequest");
		expect(byPath["/auth/password-reset/code"]?.publicWrite).toBe("resetToken");
	});
});

describe("the phone reset bodies", () => {
	it("take an address, and a code of any shape up to 32 characters, so a wrong code is a 404 and not a format hint", () => {
		expect(ok(requestResetCodeSchema, { email: "a@b.example" })).toBe(true);
		expect(ok(requestResetCodeSchema, { email: "nope" })).toBe(false);
		expect(ok(requestResetCodeSchema, {})).toBe(false);
		const mine = { email: "a@b.example", code: "abcd-2345" };
		expect(ok(redeemResetCodeSchema, mine)).toBe(true);
		expect(ok(redeemResetCodeSchema, { ...mine, code: "x" })).toBe(true);
		expect(ok(redeemResetCodeSchema, { ...mine, code: "x".repeat(32) })).toBe(
			true,
		);
		expect(ok(redeemResetCodeSchema, { ...mine, code: "" })).toBe(false);
		expect(ok(redeemResetCodeSchema, { ...mine, code: "x".repeat(33) })).toBe(
			false,
		);
	});

	it("answer the same shape for every address, and a token", () => {
		expect(ok(requestResetCodeResultSchema, { success: true })).toBe(true);
		expect(ok(requestResetCodeResultSchema, { success: false })).toBe(false);
		expect(ok(redeemResetCodeResultSchema, { token: "a".repeat(64) })).toBe(
			true,
		);
		expect(ok(redeemResetCodeResultSchema, {})).toBe(false);
	});
});
