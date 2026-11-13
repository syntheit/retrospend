/**
 * The contact hash and the one rule that decides when a writer stores it
 * (contact-hash.ts). The key work is derived here again with node:crypto, so
 * the expected values do not come from the code under test.
 */
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keyring } from "~/server/crypto/field-crypto";
import {
	TextUnavailableError,
	textUnavailableProblem,
} from "~/server/crypto/field-open";

const mocks = vi.hoisted(() => ({
	epoch: false,
	find: vi.fn(),
	getOrCreate: vi.fn(),
}));
vi.mock("~/server/crypto/epoch", () => ({
	loadEpoch: async () => mocks.epoch,
}));
vi.mock("./instance-key.service", async (importOriginal) => ({
	...(await importOriginal<typeof import("./instance-key.service")>()),
	findInstanceKeyring: mocks.find,
	getOrCreateInstanceKeyring: mocks.getOrCreate,
}));

import {
	contactHash,
	contactHashFor,
	contactHashTag,
	contactLookup,
	matchesContact,
	normalizeContactEmail,
} from "./contact-hash";
import { InstanceKeyError } from "./instance-key.service";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const ring = new Keyring([{ id: 1, key: key1 }]);
const master = new Keyring([{ id: 1, key: randomBytes(32) }]);

const SHADOW = "retrospend shadow email hash v1";
const GUEST = "retrospend guest email hash v1";

/** The documented derivation, written out again. */
function expected(key: Buffer, label: string, text: string) {
	const indexKey = Buffer.from(
		hkdfSync("sha256", key, Buffer.alloc(0), label, 32),
	);
	const tagKey = Buffer.from(
		hkdfSync("sha256", key, Buffer.alloc(0), `${label} key tag`, 8),
	);
	return `${tagKey.toString("hex")}:${createHmac("sha256", indexKey).update(text, "utf8").digest("hex")}`;
}

beforeEach(() => {
	mocks.epoch = false;
	mocks.find.mockReset();
	mocks.getOrCreate.mockReset();
});

describe("contactHash", () => {
	it("is the tag and the HMAC of the trimmed, ASCII lower-cased address, derived from the key", () => {
		expect(contactHash(ring, "shadow_profile", "  Bob@Example.COM ")).toBe(
			expected(key1, SHADOW, "bob@example.com"),
		);
		expect(contactHash(ring, "guest_session", "bob@example.com")).toBe(
			expected(key1, GUEST, "bob@example.com"),
		);
	});

	it("matches addresses that differ only in case or edge spaces, and no other", () => {
		const a = contactHash(ring, "shadow_profile", "Bob@Example.com");
		expect(contactHash(ring, "shadow_profile", " bob@example.COM\n")).toBe(a);
		expect(contactHash(ring, "shadow_profile", "bob@example.org")).not.toBe(a);
		expect(contactHash(ring, "shadow_profile", "b.ob@example.com")).not.toBe(a);
	});

	it("folds only A to Z, so the hash path and Postgres (which folds the rest by locale) cannot disagree", () => {
		// Non-ASCII letters keep their case: "É" and "é" are two addresses on
		// both lookup paths, and the JavaScript fold of "İ" never applies.
		expect(normalizeContactEmail("\tÀB@x.io ")).toBe("Àb@x.io");
		expect(normalizeContactEmail("JOSÉ@X.io")).toBe("josÉ@x.io");
		const upper = contactHash(ring, "shadow_profile", "JOSÉ@x.io");
		expect(upper).toBe(expected(key1, SHADOW, "josÉ@x.io"));
		expect(contactHash(ring, "shadow_profile", "josé@x.io")).not.toBe(upper);
		expect(contactHash(ring, "shadow_profile", "José@X.io")).not.toBe(upper);
	});

	it("gives a ghost and a guest different hashes for one address", () => {
		const shadow = contactHash(ring, "shadow_profile", "bob@example.com");
		const guest = contactHash(ring, "guest_session", "bob@example.com");
		expect(shadow.split(":")[1]).not.toBe(guest.split(":")[1]);
		expect(shadow.split(":")[0]).not.toBe(guest.split(":")[0]);
		expect(shadow).toMatch(/^[0-9a-f]{16}:[0-9a-f]{64}$/);
	});

	it("keeps the hash when a newer key is added, and changes the tag with other key bytes", () => {
		const rotated = new Keyring([
			{ id: 2, key: key2 },
			{ id: 1, key: key1 },
		]);
		expect(contactHash(rotated, "guest_session", "bob@example.com")).toBe(
			contactHash(ring, "guest_session", "bob@example.com"),
		);
		const replaced = new Keyring([{ id: 1, key: key2 }]);
		expect(contactHashTag(replaced, "guest_session")).not.toBe(
			contactHashTag(ring, "guest_session"),
		);
		expect(contactHashTag(ring, "guest_session")).toBe(
			contactHash(ring, "guest_session", "x@y.z").split(":")[0],
		);
	});
});

describe("the rule", () => {
	it("1. no master key: no hash and never an error, whatever the epoch and the ring", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockRejectedValue(new InstanceKeyError("keystore_lost"));
		mocks.find.mockRejectedValue(new InstanceKeyError("keystore_lost"));
		expect(
			await contactHashFor("shadow_profile", "a@b.co", undefined),
		).toBeNull();
		mocks.epoch = false;
		expect(
			await contactHashFor("guest_session", "a@b.co", undefined),
		).toBeNull();
		expect(mocks.getOrCreate).not.toHaveBeenCalled();
		expect(mocks.find).not.toHaveBeenCalled();
	});

	it("a null or missing address has no hash and loads no key", async () => {
		mocks.epoch = true;
		expect(await contactHashFor("shadow_profile", null, master)).toBeNull();
		expect(
			await contactHashFor("shadow_profile", undefined, master),
		).toBeNull();
		expect(mocks.getOrCreate).not.toHaveBeenCalled();
	});

	it("2. epoch set: the ring is made or read as the service, and the hash is stored", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockResolvedValue(ring);
		expect(
			await contactHashFor("shadow_profile", "Bob@Example.com", master),
		).toBe(expected(key1, SHADOW, "bob@example.com"));
		expect(mocks.getOrCreate).toHaveBeenCalledWith({ kind: "service" }, master);
		expect(mocks.find).not.toHaveBeenCalled();
	});

	it("2. epoch set and no ring: the write fails closed with encrypted_text_unavailable", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockRejectedValue(new InstanceKeyError("keystore_lost"));
		const error = await contactHashFor("guest_session", "a@b.co", master).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(TextUnavailableError);
		expect((error as TextUnavailableError).code).toBe("keystore_lost");
		expect(textUnavailableProblem(error)).toBe("encrypted_text_unavailable");
	});

	it("2. a failure that is not a key store failure is not turned into one", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockRejectedValue(new TypeError("bug"));
		await expect(
			contactHashFor("guest_session", "a@b.co", master),
		).rejects.toThrow(TypeError);
	});

	it("3. no epoch: the hash when a ring exists, and it never makes one", async () => {
		mocks.find.mockResolvedValue(ring);
		expect(await contactHashFor("guest_session", "a@b.co", master)).toBe(
			expected(key1, GUEST, "a@b.co"),
		);
		expect(mocks.getOrCreate).not.toHaveBeenCalled();
	});

	it("3. no epoch and no ring, or a key store that fails: null, not an error", async () => {
		mocks.find.mockResolvedValueOnce(undefined);
		expect(await contactHashFor("guest_session", "a@b.co", master)).toBeNull();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mocks.find.mockRejectedValueOnce(new InstanceKeyError("keystore_missing"));
		expect(await contactHashFor("guest_session", "a@b.co", master)).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("keystore_missing"),
		);
		expect(warn.mock.calls.flat().join(" ")).not.toContain("a@b.co");
		warn.mockRestore();
	});
});

describe("matchesContact", () => {
	const plaintext = {
		email: { equals: "bob@example.com", mode: "insensitive" },
	} as const;

	it("accepts every row the hash matched", () => {
		expect(matchesContact({ emailHash: "t:h" }, "bob@example.com", null)).toBe(
			true,
		);
	});

	it("keeps the plaintext rows whose address normalizes the same, and drops the superset's extras", () => {
		expect(matchesContact(plaintext, "Bob@Example.com", "BOB@example.COM")).toBe(
			true,
		);
		expect(matchesContact(plaintext, "bob@example.com", " bob@example.com")).toBe(
			true,
		);
		expect(matchesContact(plaintext, "bob@example.com", "bob@example.org")).toBe(
			false,
		);
		expect(matchesContact(plaintext, "bob@example.com", null)).toBe(false);
		// Postgres may fold a non-ASCII capital and return the row; JS says no.
		expect(matchesContact(plaintext, "josé@x.io", "JOSÉ@x.io")).toBe(false);
		expect(matchesContact(plaintext, "José@x.io", "José@X.IO")).toBe(true);
	});
});

describe("contactLookup", () => {
	it("matches the hash once the epoch is set, whatever the case of the address", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockResolvedValue(ring);
		expect(
			await contactLookup("shadow_profile", " Bob@Example.com ", master),
		).toEqual({
			emailHash: expected(key1, SHADOW, "bob@example.com"),
		});
	});

	it("matches the normalized plaintext, ignoring case, before the epoch and with no master key", async () => {
		const plaintext = {
			email: { equals: "bob@example.com", mode: "insensitive" },
		};
		expect(
			await contactLookup("guest_session", " Bob@Example.com ", master),
		).toEqual(plaintext);
		mocks.epoch = true;
		expect(
			await contactLookup("guest_session", " Bob@Example.com ", undefined),
		).toEqual(plaintext);
		expect(mocks.getOrCreate).not.toHaveBeenCalled();
	});

	it("fails closed with an epoch and no ring, never falling back to a plaintext match", async () => {
		mocks.epoch = true;
		mocks.getOrCreate.mockRejectedValue(new InstanceKeyError("keystore_lost"));
		await expect(
			contactLookup("shadow_profile", "a@b.co", master),
		).rejects.toBeInstanceOf(TextUnavailableError);
	});
});
