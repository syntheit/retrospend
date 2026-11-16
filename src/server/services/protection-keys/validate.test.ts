// The validation against real wraps made by @retrospend/crypto, so a change to
// a wrap format there (size, header) fails here before it fails in production,
// and the server's idea of a valid wrap cannot drift from the client's. Every
// refusal has an accepted twin that differs in the one thing under test.
import {
	ARGON2_CEILING,
	ARGON2_FLOOR,
	type Primitives,
	type PublicRole,
	type SymmetricRole,
	wrapKey,
	wrapKeyToPublic,
} from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it } from "vitest";
import { ProtectionKeysError } from "./errors";
import {
	type KeyChanges,
	MAX_CHANGES,
	validateKeyChanges,
	type WrapInput,
	type WrapRole,
} from "./validate";

const USER = "user_1";
let p: Primitives;
let wraps: Record<WrapRole, WrapInput>;
let create: KeyChanges;

beforeAll(async () => {
	p = await createWebPrimitives();
	const key = p.randomBytes(32);
	const wrappingKey = p.randomBytes(32);
	const pair = p.boxKeypair();
	const symmetric = (role: SymmetricRole, targetId: string): WrapInput => ({
		role,
		targetId,
		wrapped: wrapKey(p, wrappingKey, role, targetId, key),
	});
	const sealed = (role: PublicRole, targetId: string): WrapInput => ({
		role,
		targetId,
		wrapped: wrapKeyToPublic(p, pair.publicKey, role, targetId, key),
	});
	wraps = {
		"ak-password": symmetric("ak-password", USER),
		"ak-recovery": symmetric("ak-recovery", USER),
		"private-key": symmetric("private-key", USER),
		"collection-key": symmetric(
			"collection-key",
			"00ff00ff00ff00ff00ff00ff00ff00ff",
		),
		"ak-device": sealed("ak-device", "device-1"),
		"ak-contact": sealed("ak-contact", "contact_2"),
	};
	create = {
		baseVersion: 0,
		set: {
			kdfSalt: p.randomBytes(16),
			kdfMemoryKiB: 64 * 1024,
			kdfPasses: 3,
			publicKey: pair.publicKey,
		},
		put: Object.values(wraps),
		remove: [],
	};
});

const code = (changes: KeyChanges): string => {
	try {
		validateKeyChanges(USER, changes);
		return "ok";
	} catch (error) {
		return error instanceof ProtectionKeysError ? error.code : "other";
	}
};
const withWrap = (patch: Partial<WrapInput>, role: WrapRole): KeyChanges => ({
	...create,
	put: [{ ...wraps[role], ...patch }],
});
const ROLES = [
	"ak-password",
	"ak-recovery",
	"private-key",
	"collection-key",
	"ak-device",
	"ak-contact",
] as const;

describe("a change made of real wraps", () => {
	it("is accepted for every role, all at once and one by one", () => {
		expect(code(create)).toBe("ok");
		for (const role of ROLES) expect(code(withWrap({}, role))).toBe("ok");
	});

	it("is 74 bytes for the symmetric roles and 98 for the sealed ones", () => {
		for (const role of ROLES.slice(0, 4))
			expect(wraps[role].wrapped.length).toBe(74);
		for (const role of ROLES.slice(4))
			expect(wraps[role].wrapped.length).toBe(98);
	});

	it("refuses a changed length, header or role-to-format pairing", () => {
		for (const role of ROLES) {
			const bytes = wraps[role].wrapped;
			expect(code(withWrap({ wrapped: bytes.slice(1) }, role)), role).toBe(
				"invalid_input",
			);
			expect(
				code(withWrap({ wrapped: Uint8Array.of(...bytes, 0) }, role)),
				role,
			).toBe("invalid_input");
			for (const at of [0, 1]) {
				const t = bytes.slice();
				t[at] = 9;
				expect(code(withWrap({ wrapped: t }, role)), role).toBe(
					"invalid_input",
				);
			}
		}
		// A symmetric wrap offered as a device wrap and the other way round.
		const symmetric = wraps["ak-password"].wrapped;
		const sealed = wraps["ak-device"].wrapped;
		expect(code(withWrap({ wrapped: symmetric }, "ak-device"))).toBe(
			"invalid_input",
		);
		expect(code(withWrap({ wrapped: sealed }, "ak-password"))).toBe(
			"invalid_input",
		);
		// Right size, wrong header: a sealed-sized body that claims format 1.
		const sealedAsSymmetric = sealed.slice();
		sealedAsSymmetric[1] = 1;
		expect(code(withWrap({ wrapped: sealedAsSymmetric }, "ak-device"))).toBe(
			"invalid_input",
		);
	});
});

describe("role and target", () => {
	it("refuses an unknown role", () => {
		expect(
			code(withWrap({ role: "ak-other" as WrapRole }, "collection-key")),
		).toBe("invalid_input");
	});

	it("pins the target of the account key and private key wraps to the user", () => {
		for (const role of ["ak-password", "ak-recovery", "private-key"] as const) {
			expect(code(withWrap({ targetId: "someone_else" }, role)), role).toBe(
				"invalid_input",
			);
		}
		// The other roles take any id of the right shape.
		expect(code(withWrap({ targetId: "other-device" }, "ak-device"))).toBe(
			"ok",
		);
	});

	it("refuses a target outside the id pattern", () => {
		for (const targetId of ["", "a".repeat(65), "has space", "slash/id", "ü"]) {
			expect(code(withWrap({ targetId }, "collection-key")), targetId).toBe(
				"invalid_input",
			);
		}
		expect(code(withWrap({ targetId: "a".repeat(64) }, "collection-key"))).toBe(
			"ok",
		);
	});

	it("refuses a wrap id that is not a uuid, accepts one that is", () => {
		expect(code(withWrap({ id: "not-a-uuid" }, "ak-device"))).toBe(
			"invalid_input",
		);
		expect(
			code(
				withWrap({ id: "0b0e6c6e-0000-4000-8000-000000000001" }, "ak-device"),
			),
		).toBe("ok");
	});

	it("refuses two wraps for one role and target in one change", () => {
		expect(
			code({ ...create, put: [wraps["ak-device"], wraps["ak-device"]] }),
		).toBe("invalid_input");
		expect(
			code({
				...create,
				put: [wraps["ak-device"], { ...wraps["ak-device"], targetId: "d2" }],
			}),
		).toBe("ok");
	});

	it("checks what remove names too", () => {
		const base = { ...create, baseVersion: 1, set: undefined, put: [] };
		expect(
			code({ ...base, remove: [{ role: "ak-device", targetId: "d1" }] }),
		).toBe("ok");
		expect(
			code({ ...base, remove: [{ role: "ak-device", targetId: "no/slash" }] }),
		).toBe("invalid_input");
		expect(
			code({ ...base, remove: [{ role: "ak-password", targetId: "other" }] }),
		).toBe("invalid_input");
	});
});

describe("the key set", () => {
	const setWith = (patch: object): KeyChanges => ({
		...create,
		set: { ...(create.set as object), ...patch } as KeyChanges["set"],
	});

	it("needs a 16 byte salt and a 32 byte public key to be created", () => {
		expect(code(setWith({ kdfSalt: p.randomBytes(15) }))).toBe("invalid_input");
		expect(code(setWith({ kdfSalt: p.randomBytes(17) }))).toBe("invalid_input");
		expect(code(setWith({ publicKey: p.randomBytes(31) }))).toBe(
			"invalid_input",
		);
		expect(code(setWith({ publicKey: undefined }))).toBe("invalid_input");
		expect(code({ ...create, set: undefined })).toBe("invalid_input");
	});

	it("holds the Argon2 floor and ceiling", () => {
		const atFloor = {
			kdfMemoryKiB: ARGON2_FLOOR.memoryKiB,
			kdfPasses: ARGON2_FLOOR.passes,
		};
		const atCeiling = {
			kdfMemoryKiB: ARGON2_CEILING.memoryKiB,
			kdfPasses: ARGON2_CEILING.passes,
		};
		expect(code(setWith(atFloor))).toBe("ok");
		expect(code(setWith(atCeiling))).toBe("ok");
		expect(code(setWith({ kdfMemoryKiB: ARGON2_FLOOR.memoryKiB - 1 }))).toBe(
			"invalid_input",
		);
		expect(code(setWith({ kdfPasses: 0 }))).toBe("invalid_input");
		expect(code(setWith({ kdfMemoryKiB: ARGON2_CEILING.memoryKiB + 1 }))).toBe(
			"invalid_input",
		);
		expect(code(setWith({ kdfPasses: ARGON2_CEILING.passes + 1 }))).toBe(
			"invalid_input",
		);
		expect(code(setWith({ kdfPasses: 2.5 }))).toBe("invalid_input");
	});

	it("never takes a public key after the set exists, and refuses an empty change", () => {
		const update = (patch: Partial<KeyChanges>): KeyChanges => ({
			baseVersion: 3,
			put: [],
			remove: [],
			...patch,
		});
		const params = {
			kdfSalt: p.randomBytes(16),
			kdfMemoryKiB: 64 * 1024,
			kdfPasses: 3,
		};
		expect(code(update({ set: params }))).toBe("ok");
		expect(
			code(update({ set: { ...params, publicKey: p.randomBytes(32) } })),
		).toBe("invalid_input");
		expect(code(update({ put: [wraps["ak-device"]] }))).toBe("ok");
		expect(code(update({}))).toBe("invalid_input");
	});
});

describe("baseVersion and size", () => {
	it("is a whole number, zero or more", () => {
		expect(code({ ...create, baseVersion: -1 })).toBe("invalid_input");
		expect(code({ ...create, baseVersion: 0.5 })).toBe("invalid_input");
		expect(code({ ...create, baseVersion: Number.NaN })).toBe("invalid_input");
	});

	it("bounds one change", () => {
		const refs = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				role: "collection-key" as const,
				targetId: `k${i}`,
			}));
		const base = { ...create, put: [] };
		expect(code({ ...base, remove: refs(MAX_CHANGES) })).toBe("ok");
		expect(code({ ...base, remove: refs(MAX_CHANGES + 1) })).toBe(
			"invalid_input",
		);
	});
});
