import { describe, expect, it } from "vitest";
import {
	beginPasswordRotationSchema,
	enableProtectionSchema,
	rotatePasswordSchema,
} from "../protection";
import { enableWrapSchema, preloginKdfSchema } from "./index";

const b64 = (n: number) => "A".repeat(n);
const KEY = b64(43);
const KDF = { salt: b64(22), memoryKiB: 65_536, passes: 3 };
const WRAPS = [
	{ role: "ak-password", targetId: "user_1", wrapped: b64(100) },
	{ role: "ak-recovery", targetId: "user_1", wrapped: b64(100) },
	{ role: "private-key", targetId: "user_1", wrapped: b64(100) },
	{
		role: "collection-key",
		targetId: "00ff00ff00ff00ff00ff00ff00ff00ff",
		wrapped: b64(100),
	},
];
const enable = (over: Record<string, unknown> = {}) => ({
	currentPassword: "typed",
	authKey: KEY,
	recoveryAuthKey: KEY,
	kdf: KDF,
	publicKey: KEY,
	wraps: WRAPS,
	...over,
});
const ok = (
	schema: { safeParse: (v: unknown) => { success: boolean } },
	v: unknown,
) => schema.safeParse(v).success;

describe("the key text (43 characters of base64url)", () => {
	it("takes exactly 43 on every field that carries a key", () => {
		expect(ok(enableProtectionSchema, enable())).toBe(true);
		for (const length of [42, 44]) {
			expect(ok(enableProtectionSchema, enable({ authKey: b64(length) }))).toBe(
				false,
			);
			expect(
				ok(enableProtectionSchema, enable({ publicKey: b64(length) })),
			).toBe(false);
			expect(
				ok(enableProtectionSchema, enable({ recoveryAuthKey: b64(length) })),
			).toBe(false);
			expect(
				ok(beginPasswordRotationSchema, { currentAuthKey: b64(length) }),
			).toBe(false);
			for (const field of ["currentAuthKey", "newAuthKey"]) {
				expect(
					ok(rotatePasswordSchema, {
						currentAuthKey: KEY,
						newAuthKey: KEY,
						kdf: KDF,
						wrappedAccountKey: b64(100),
						baseVersion: 1,
						[field]: b64(length),
					}),
				).toBe(false);
			}
		}
		expect(ok(beginPasswordRotationSchema, { currentAuthKey: KEY })).toBe(true);
	});

	it("refuses padding and characters outside base64url", () => {
		expect(
			ok(beginPasswordRotationSchema, { currentAuthKey: `${b64(42)}=` }),
		).toBe(false);
		expect(
			ok(beginPasswordRotationSchema, { currentAuthKey: `${b64(42)}+` }),
		).toBe(false);
		expect(
			ok(beginPasswordRotationSchema, { currentAuthKey: `${b64(42)}_` }),
		).toBe(true);
	});
});

describe("the wrap text (1 to 512 characters)", () => {
	const rotate = (wrappedAccountKey: string) => ({
		currentAuthKey: KEY,
		newAuthKey: KEY,
		kdf: KDF,
		wrappedAccountKey,
		baseVersion: 1,
	});
	const wrapOf = (wrapped: string) =>
		enableWrapSchema.safeParse({ role: "private-key", targetId: "u", wrapped })
			.success;

	it("takes 1 and 512 and refuses 0 and 513, in a rotation and in an enable wrap", () => {
		expect(ok(rotatePasswordSchema, rotate(b64(512)))).toBe(true);
		expect(ok(rotatePasswordSchema, rotate(b64(1)))).toBe(true);
		expect(ok(rotatePasswordSchema, rotate(b64(513)))).toBe(false);
		expect(ok(rotatePasswordSchema, rotate(""))).toBe(false);
		expect(wrapOf(b64(512))).toBe(true);
		expect(wrapOf(b64(513))).toBe(false);
		expect(wrapOf("")).toBe(false);
		expect(wrapOf("has space")).toBe(false);
	});
});

describe("the kdf parameters", () => {
	const kdf = (over: object) =>
		preloginKdfSchema.safeParse({ ...KDF, ...over });

	it("takes a 22 character salt and refuses 21 and 23", () => {
		expect(kdf({}).success).toBe(true);
		expect(kdf({ salt: b64(21) }).success).toBe(false);
		expect(kdf({ salt: b64(23) }).success).toBe(false);
		expect(kdf({ salt: `${b64(21)}=` }).success).toBe(false);
	});

	it("takes memory and passes of 1 or more, whole numbers only", () => {
		expect(kdf({ memoryKiB: 1 }).success).toBe(true);
		expect(kdf({ memoryKiB: 0 }).success).toBe(false);
		expect(kdf({ memoryKiB: -1 }).success).toBe(false);
		expect(kdf({ memoryKiB: 1.5 }).success).toBe(false);
		expect(kdf({ passes: 1 }).success).toBe(true);
		expect(kdf({ passes: 0 }).success).toBe(false);
		expect(kdf({ passes: 2.5 }).success).toBe(false);
	});

	it("is the schema the enable and rotate bodies use", () => {
		expect(
			ok(enableProtectionSchema, enable({ kdf: { ...KDF, passes: 0 } })),
		).toBe(false);
		expect(
			ok(enableProtectionSchema, enable({ kdf: { ...KDF, salt: b64(23) } })),
		).toBe(false);
		expect(
			ok(rotatePasswordSchema, {
				currentAuthKey: KEY,
				newAuthKey: KEY,
				kdf: { ...KDF, memoryKiB: 0 },
				wrappedAccountKey: b64(100),
				baseVersion: 1,
			}),
		).toBe(false);
	});
});

describe("the recovery proof of an enable body", () => {
	it("is required, and is a key text, not any string", () => {
		const { recoveryAuthKey: _omitted, ...without } = enable();
		expect(ok(enableProtectionSchema, without)).toBe(false);
		expect(
			ok(enableProtectionSchema, enable({ recoveryAuthKey: undefined })),
		).toBe(false);
		expect(ok(enableProtectionSchema, enable({ recoveryAuthKey: "" }))).toBe(
			false,
		);
		expect(ok(enableProtectionSchema, enable({ recoveryAuthKey: 7 }))).toBe(
			false,
		);
		expect(ok(enableProtectionSchema, enable())).toBe(true);
	});
});

describe("the wrap roles an enable body must carry", () => {
	it("needs one each of four roles and nothing else", () => {
		expect(ok(enableProtectionSchema, enable({ wraps: WRAPS.slice(1) }))).toBe(
			false,
		);
		const unknown = [...WRAPS.slice(0, 3), { ...WRAPS[3], role: "ak-device" }];
		expect(ok(enableProtectionSchema, enable({ wraps: unknown }))).toBe(false);
	});

	it("names a collection key by lowercase hex of 32 characters", () => {
		const collection = (targetId: string) =>
			enableWrapSchema.safeParse({
				role: "collection-key",
				targetId,
				wrapped: b64(100),
			}).success;
		expect(collection("0".repeat(32))).toBe(true);
		expect(collection("0".repeat(31))).toBe(false);
		expect(collection("0".repeat(33))).toBe(false);
		expect(collection("A".repeat(32))).toBe(false);
	});
});
