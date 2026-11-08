/**
 * Expected values were derived outside this code, with Python's hmac and a
 * hand-written RFC 5869 HKDF (extract with a zero salt, one expand block):
 *
 *   key = bytes 1..32, label = "retrospend category name index v1"
 *   index("Food") = 5ee20b7c...10bac
 *   other label   -> d23f10ec...f03b2
 *   index("Café") = 9f6cee16...7b7   (UTF-8, precomposed U+00E9)
 *   tag = first 8 bytes of HKDF(key, info = label + " key tag") = c7d189e5ac1ba1ba
 *   tag of a key of 32 bytes of 0x07 = a235c87b40749ae1
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blindIndex, blindIndexTag } from "./blind-index";
import { FieldCryptoError, Keyring } from "./field-crypto";

const LABEL = "retrospend category name index v1";
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const ring = new Keyring([{ id: 1, key }]);

describe("blindIndex", () => {
	it("matches an independent derivation", () => {
		expect(blindIndex(ring, LABEL, "Food")).toBe(
			"5ee20b7ccf06d97b21b7ee7dcd735c41ad865989853c87e2735221e7fb910bac",
		);
		expect(blindIndex(ring, "other label", "Food")).toBe(
			"d23f10ec632348ceff7fd4beb36eb826a3d3d06ddd0130bf927b2e3df39f03b2",
		);
		expect(blindIndex(ring, LABEL, "Café")).toBe(
			"9f6cee164ba58ed1f4b5bfc659a28ae0421581e94aeb76687d16e4223feaa7b7",
		);
	});

	it("differs by key, by label and by text", () => {
		const other = new Keyring([{ id: 1, key: randomBytes(32) }]);
		expect(blindIndex(other, LABEL, "Food")).not.toBe(
			blindIndex(ring, LABEL, "Food"),
		);
		expect(blindIndex(ring, LABEL, "food")).not.toBe(
			blindIndex(ring, LABEL, "Food"),
		);
	});

	it("follows the oldest key, so a rotation does not change it", () => {
		const rotated = new Keyring([
			{ id: 2, key: randomBytes(32) },
			{ id: 1, key },
		]);
		expect(blindIndex(rotated, LABEL, "Food")).toBe(
			blindIndex(ring, LABEL, "Food"),
		);
	});

	it("refuses an empty label", () => {
		expect(() => blindIndex(ring, "", "Food")).toThrow(FieldCryptoError);
	});

	it("tags the key material, not its id", () => {
		expect(blindIndexTag(ring, LABEL)).toBe("c7d189e5ac1ba1ba");
		// A key made again under the same id has other bytes and another tag.
		const again = new Keyring([{ id: 1, key: Buffer.alloc(32, 7) }]);
		expect(blindIndexTag(again, LABEL)).toBe("a235c87b40749ae1");
		// The same bytes under another id keep the tag; a rotation keeps it too.
		const moved = new Keyring([{ id: 9, key }]);
		expect(blindIndexTag(moved, LABEL)).toBe("c7d189e5ac1ba1ba");
		const rotated = new Keyring([
			{ id: 2, key: randomBytes(32) },
			{ id: 1, key },
		]);
		expect(blindIndexTag(rotated, LABEL)).toBe("c7d189e5ac1ba1ba");
	});
});
