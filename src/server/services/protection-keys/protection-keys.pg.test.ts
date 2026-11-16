/**
 * getProtectionKeys and applyKeyChanges on real Postgres, as a signed-in user
 * (userTransaction sets the RLS user and the app role): the conflict rules,
 * replacement, the lock between two writers, and the all-or-nothing change.
 */

import { type Primitives, wrapKey, wrapKeyToPublic } from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { createTestUser } from "~/test/pg-harness";
import {
	applyKeyChanges,
	getProtectionKeys,
	type KeyChanges,
	ProtectionKeysError,
	type WrapInput,
} from "./protection-keys.service";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

async function newUser() {
	const { user, db } = await createTestUser();
	const run = <T>(work: Parameters<typeof userTransaction<T>>[2]) =>
		userTransaction(db, user.id, work);
	return { id: user.id, run };
}

const akPassword = (userId: string): WrapInput => ({
	role: "ak-password",
	targetId: userId,
	wrapped: wrapKey(
		p,
		p.randomBytes(32),
		"ak-password",
		userId,
		p.randomBytes(32),
	),
});
const device = (targetId: string): WrapInput => ({
	role: "ak-device",
	targetId,
	wrapped: wrapKeyToPublic(
		p,
		p.boxKeypair().publicKey,
		"ak-device",
		targetId,
		p.randomBytes(32),
	),
});
const create = (put: WrapInput[]): KeyChanges => ({
	baseVersion: 0,
	set: {
		kdfSalt: p.randomBytes(16),
		kdfMemoryKiB: 64 * 1024,
		kdfPasses: 3,
		publicKey: p.boxKeypair().publicKey,
	},
	put,
	remove: [],
});
const codeOf = async (work: Promise<unknown>) =>
	work.then(
		() => "ok",
		(error) => (error instanceof ProtectionKeysError ? error.code : error),
	);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("creating and reading", () => {
	it("returns null before a set exists and what was stored after", async () => {
		const u = await newUser();
		expect(await u.run((tx) => getProtectionKeys(tx, u.id))).toBeNull();

		const change = create([akPassword(u.id), device("d1")]);
		expect(await u.run((tx) => applyKeyChanges(tx, u.id, change))).toEqual({
			version: 1,
		});

		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(stored?.version).toBe(1);
		expect(stored?.kdfMemoryKiB).toBe(64 * 1024);
		expect(stored?.kdfPasses).toBe(3);
		expect(hex(stored?.kdfSalt ?? new Uint8Array())).toBe(
			hex(change.set?.kdfSalt as Uint8Array),
		);
		expect(hex(stored?.publicKey ?? new Uint8Array())).toBe(
			hex(change.set?.publicKey as Uint8Array),
		);
		// The bytes come back exactly, as plain Uint8Arrays, ordered by role and target.
		expect(stored?.wraps.map((w) => [w.role, w.targetId])).toEqual([
			["ak-device", "d1"],
			["ak-password", u.id],
		]);
		for (const w of stored?.wraps ?? []) {
			const sent = change.put.find((x) => x.role === w.role);
			expect(hex(w.wrapped)).toBe(hex(sent?.wrapped as Uint8Array));
			expect(w.wrapped.constructor).toBe(Uint8Array);
		}
	});

	it("reads a set that has no wraps, and refuses to create one twice", async () => {
		const u = await newUser();
		await u.run((tx) => applyKeyChanges(tx, u.id, create([])));
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(stored?.wraps).toEqual([]);
		expect(
			await codeOf(u.run((tx) => applyKeyChanges(tx, u.id, create([])))),
		).toBe("conflict");
	});

	it("keeps another user's set out of reach", async () => {
		const a = await newUser();
		const b = await newUser();
		await a.run((tx) => applyKeyChanges(tx, a.id, create([akPassword(a.id)])));
		expect(await b.run((tx) => getProtectionKeys(tx, a.id))).toBeNull();
		expect(await b.run((tx) => getProtectionKeys(tx, b.id))).toBeNull();
	});
});

describe("changing", () => {
	it("refuses a stale or unknown base version and changes nothing", async () => {
		const u = await newUser();
		await u.run((tx) => applyKeyChanges(tx, u.id, create([akPassword(u.id)])));
		const attempt = (baseVersion: number) =>
			codeOf(
				u.run((tx) =>
					applyKeyChanges(tx, u.id, {
						baseVersion,
						put: [device("d1")],
						remove: [],
					}),
				),
			);
		expect(await attempt(2)).toBe("conflict");
		expect(await attempt(7)).toBe("conflict");
		expect((await u.run((tx) => getProtectionKeys(tx, u.id)))?.version).toBe(1);
		expect(await attempt(1)).toBe("ok");
		// Now version 2: the version just used is stale.
		expect(await attempt(1)).toBe("conflict");
		// A user without a set cannot update one into being.
		const empty = await newUser();
		expect(
			await codeOf(
				empty.run((tx) =>
					applyKeyChanges(tx, empty.id, {
						baseVersion: 1,
						put: [device("d1")],
						remove: [],
					}),
				),
			),
		).toBe("conflict");
	});

	it("replaces a wrap of the same role and target and leaves no old row", async () => {
		const u = await newUser();
		const first = akPassword(u.id);
		await u.run((tx) =>
			applyKeyChanges(tx, u.id, create([first, device("d1")])),
		);
		const second = akPassword(u.id);
		expect(hex(second.wrapped)).not.toBe(hex(first.wrapped));
		const done = await u.run((tx) =>
			applyKeyChanges(tx, u.id, { baseVersion: 1, put: [second], remove: [] }),
		);
		expect(done.version).toBe(2);
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		const passwords =
			stored?.wraps.filter((w) => w.role === "ak-password") ?? [];
		expect(passwords).toHaveLength(1);
		expect(hex(passwords[0]?.wrapped as Uint8Array)).toBe(hex(second.wrapped));
		// The other wrap is untouched.
		expect(stored?.wraps.map((w) => w.targetId).sort()).toEqual(
			["d1", u.id].sort(),
		);
	});

	it("removes the wraps it names and updates the parameters without touching the public key", async () => {
		const u = await newUser();
		const made = create([akPassword(u.id), device("d1"), device("d2")]);
		await u.run((tx) => applyKeyChanges(tx, u.id, made));
		const salt = p.randomBytes(16);
		await u.run((tx) =>
			applyKeyChanges(tx, u.id, {
				baseVersion: 1,
				set: { kdfSalt: salt, kdfMemoryKiB: 100_000, kdfPasses: 4 },
				put: [],
				remove: [
					{ role: "ak-device", targetId: "d1" },
					{ role: "ak-device", targetId: "never-existed" },
				],
			}),
		);
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(stored?.version).toBe(2);
		expect(stored?.wraps.map((w) => w.targetId).sort()).toEqual(
			["d2", u.id].sort(),
		);
		expect(hex(stored?.kdfSalt as Uint8Array)).toBe(hex(salt));
		expect([stored?.kdfMemoryKiB, stored?.kdfPasses]).toEqual([100_000, 4]);
		expect(hex(stored?.publicKey as Uint8Array)).toBe(
			hex(made.set?.publicKey as Uint8Array),
		);
	});

	it("moves the version once for a change of many wraps", async () => {
		const u = await newUser();
		await u.run((tx) => applyKeyChanges(tx, u.id, create([akPassword(u.id)])));
		const done = await u.run((tx) =>
			applyKeyChanges(tx, u.id, {
				baseVersion: 1,
				put: [device("d1"), device("d2"), device("d3"), akPassword(u.id)],
				remove: [],
			}),
		);
		expect(done.version).toBe(2);
	});
});

describe("two writers and a failing change", () => {
	/** A promise and the function that settles it. */
	function latch() {
		let open: () => void = () => undefined;
		const done = new Promise<void>((resolve) => {
			open = resolve;
		});
		return { done, open };
	}

	it("lets exactly one of two changes from one version through, with no mixed set", async () => {
		const u = await newUser();
		await u.run((tx) => applyKeyChanges(tx, u.id, create([akPassword(u.id)])));
		const first = device("from-first");
		const second = device("from-second");

		const hold = latch();
		const applied = latch();
		const a = u.run(async (tx) => {
			await applyKeyChanges(tx, u.id, {
				baseVersion: 1,
				put: [first],
				remove: [],
			});
			applied.open();
			await hold.done; // the row stays locked until here
		});
		await applied.done;
		// B starts while A's transaction is open and waits on the row lock.
		const b = codeOf(
			u.run((tx) =>
				applyKeyChanges(tx, u.id, {
					baseVersion: 1,
					put: [second],
					remove: [],
				}),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));
		hold.open();
		await a;

		expect(await b).toBe("conflict");
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(stored?.version).toBe(2);
		expect(stored?.wraps.map((w) => w.targetId).sort()).toEqual(
			["from-first", u.id].sort(),
		);
	});

	it("lets exactly one of two creators through", async () => {
		const u = await newUser();
		const hold = latch();
		const applied = latch();
		const winner = create([akPassword(u.id)]);
		const a = u.run(async (tx) => {
			await applyKeyChanges(tx, u.id, winner);
			applied.open();
			await hold.done;
		});
		await applied.done;
		const b = codeOf(
			u.run((tx) => applyKeyChanges(tx, u.id, create([device("late")]))),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));
		hold.open();
		await a;
		expect(await b).toBe("conflict");
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(hex(stored?.publicKey as Uint8Array)).toBe(
			hex(winner.set?.publicKey as Uint8Array),
		);
		expect(stored?.wraps.map((w) => w.role)).toEqual(["ak-password"]);
	});

	it("rolls the whole change back when a later insert fails", async () => {
		const u = await newUser();
		const old = akPassword(u.id);
		await u.run((tx) =>
			applyKeyChanges(tx, u.id, create([old, device("keep")])),
		);
		// Two wraps with one client id: the single insert fails after the delete
		// and the version bump have run.
		const id = "0b0e6c6e-0000-4000-8000-000000000001";
		const failing: KeyChanges = {
			baseVersion: 1,
			set: { kdfSalt: p.randomBytes(16), kdfMemoryKiB: 70_000, kdfPasses: 2 },
			put: [
				{ ...akPassword(u.id), id },
				{ ...device("d9"), id },
			],
			remove: [{ role: "ak-device", targetId: "keep" }],
		};
		expect(
			await codeOf(u.run((tx) => applyKeyChanges(tx, u.id, failing))),
		).toBe("conflict");
		const stored = await u.run((tx) => getProtectionKeys(tx, u.id));
		expect(stored?.version).toBe(1);
		expect(stored?.kdfMemoryKiB).toBe(64 * 1024);
		expect(stored?.wraps.map((w) => w.targetId).sort()).toEqual(
			["keep", u.id].sort(),
		);
		const kept = stored?.wraps.find((w) => w.role === "ak-password");
		expect(hex(kept?.wrapped as Uint8Array)).toBe(hex(old.wrapped));
	});

	it("refuses a malformed change before touching the database", async () => {
		const u = await newUser();
		await u.run((tx) => applyKeyChanges(tx, u.id, create([akPassword(u.id)])));
		const bad = { ...akPassword(u.id), wrapped: new Uint8Array(74) };
		expect(
			await codeOf(
				u.run((tx) =>
					applyKeyChanges(tx, u.id, { baseVersion: 1, put: [bad], remove: [] }),
				),
			),
		).toBe("invalid_input");
		expect((await u.run((tx) => getProtectionKeys(tx, u.id)))?.version).toBe(1);
	});
});
