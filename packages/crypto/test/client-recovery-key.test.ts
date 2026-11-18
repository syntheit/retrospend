// The shared parts of showing a recovery key (src/client/recovery-key.ts):
// which two groups to ask for, whether a typed group matches, and the file.
import { beforeAll, describe, expect, it } from "vitest";
import { CryptoError, type Primitives } from "../src";
import {
	groupMatches,
	pickConfirmGroups,
	randomBelow,
	recoveryKeyFileText,
} from "../src/client";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const ZERO = vectors.recoveryKeys[0];
const ASCENDING = vectors.recoveryKeys[2];
if (!ZERO || !ASCENDING) throw new Error("vector missing");
// "all zero": every group is six zeros, so look-alikes can be typed for it.
const ZERO_GROUP = ZERO.text.split("-")[0] as string;

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof CryptoError ? e.code : "other";
	}
	return "none";
};

describe("pickConfirmGroups", () => {
	it("never repeats a group, for every number the randomness can give", () => {
		const seen = new Set<string>();
		for (let r = 0; r < 36; r++) {
			const [a, b] = pickConfirmGroups(() => r);
			expect(a).not.toBe(b);
			expect(a).toBeLessThan(b);
			expect(a).toBeGreaterThanOrEqual(0);
			expect(b).toBeLessThan(9);
			seen.add(`${a},${b}`);
		}
		// Each of the 36 different pairs is reachable.
		expect(seen.size).toBe(36);
	});

	it("is distinct even when the randomness always gives the same number", () => {
		for (const r of [0, 1, 35]) {
			const [a, b] = pickConfirmGroups(() => r);
			expect(a).not.toBe(b);
		}
	});

	it("shows new groups after Back: the pair it just showed is left out", () => {
		const first = pickConfirmGroups(() => 7);
		for (let r = 0; r < 35; r++) {
			const next = pickConfirmGroups(() => r, first);
			expect(`${next[0]},${next[1]}`).not.toBe(`${first[0]},${first[1]}`);
		}
		// All 35 other pairs stay reachable.
		const reached = new Set<string>();
		for (let r = 0; r < 35; r++) {
			const [a, b] = pickConfirmGroups(() => r, first);
			reached.add(`${a},${b}`);
		}
		expect(reached.size).toBe(35);
	});

	it("asks the randomness for a number below the count of candidates", () => {
		const asked: number[] = [];
		pickConfirmGroups((below) => {
			asked.push(below);
			return 0;
		});
		pickConfirmGroups(
			(below) => {
				asked.push(below);
				return 0;
			},
			[0, 1],
		);
		expect(asked).toEqual([36, 35]);
	});

	it("refuses a number outside the range, a fraction or NaN", () => {
		for (const r of [-1, 36, 1.5, Number.NaN]) {
			expect(code(() => pickConfirmGroups(() => r))).toBe("invalid_input");
		}
	});
});

describe("randomBelow", () => {
	const feed = (...values: number[]) => ({
		randomBytes: () => Uint8Array.of(values.shift() as number),
	});

	it("maps a byte to its remainder", () => {
		expect(randomBelow(feed(8), 9)).toBe(8);
		expect(randomBelow(feed(9), 9)).toBe(0);
		expect(randomBelow(feed(251), 9)).toBe(8);
	});

	it("throws away bytes above the largest multiple, so no number is likelier", () => {
		// 256 % 9 = 4: bytes 252 to 255 would make 0 to 3 likelier.
		expect(randomBelow(feed(255, 252, 253, 254, 4), 9)).toBe(4);
		expect(randomBelow(feed(255, 7), 36)).toBe(7);
		expect(randomBelow(feed(255), 1)).toBe(0);
	});

	it("refuses a size that is not 1 to 256", () => {
		for (const n of [0, -1, 257, 2.5, Number.NaN]) {
			expect(code(() => randomBelow(p, n))).toBe("invalid_input");
		}
	});

	it("gives a number below the size from the real primitives", () => {
		for (let i = 0; i < 200; i++) {
			const n = randomBelow(p, 36);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(36);
		}
	});
});

describe("groupMatches", () => {
	it("accepts the group as shown, in any case, with spaces or hyphens", () => {
		const group = ASCENDING.text.split("-")[3] as string;
		expect(groupMatches(group, group)).toBe(true);
		expect(groupMatches(group.toLowerCase(), group)).toBe(true);
		expect(
			groupMatches(` ${group.slice(0, 3)} - ${group.slice(3)} `, group),
		).toBe(true);
	});

	it("reads O as 0 and I and L as 1, like the whole key", () => {
		expect(groupMatches("oooooo", ZERO_GROUP)).toBe(true);
		expect(groupMatches("OoOoOo", ZERO_GROUP)).toBe(true);
		const ones = "111111";
		expect(groupMatches("illIlL", ones)).toBe(true);
		// The same rule parseRecoveryKey uses: O is not an "o" symbol.
		expect(groupMatches("OOOOOO", ones)).toBe(false);
	});

	it("does not accept another group, a part, a longer text or an empty one", () => {
		const groups = ASCENDING.text.split("-");
		expect(groupMatches(groups[1] as string, groups[0] as string)).toBe(false);
		expect(
			groupMatches((groups[0] as string).slice(0, 5), groups[0] as string),
		).toBe(false);
		expect(groupMatches(`${groups[0]}${groups[1]}`, groups[0] as string)).toBe(
			false,
		);
		expect(groupMatches("", groups[0] as string)).toBe(false);
	});

	it("does not accept text that is not printable ASCII, and does not throw", () => {
		expect(groupMatches(`${ZERO_GROUP.slice(0, 5)}é`, ZERO_GROUP)).toBe(false);
		expect(groupMatches(undefined as unknown as string, ZERO_GROUP)).toBe(
			false,
		);
	});
});

describe("recoveryKeyFileText", () => {
	const labels = {
		title: "Retrospend recovery key",
		account: "Account",
		made: "Made",
		key: "Recovery key",
		keepSafe: "Keep this file somewhere safe.",
	};

	it("writes the same lines on every platform", () => {
		const text = recoveryKeyFileText(labels, {
			keyText: ASCENDING.text,
			account: "ana@example.com",
			made: "Nov 18, 2026",
		});
		expect(text).toBe(
			[
				"Retrospend recovery key",
				"",
				"Account: ana@example.com",
				"Made: Nov 18, 2026",
				"",
				"Recovery key:",
				ASCENDING.text,
				"",
				"Keep this file somewhere safe.",
				"",
			].join("\n"),
		);
	});

	it("writes the key in its canonical form from a typed one", () => {
		const text = recoveryKeyFileText(labels, {
			keyText: ASCENDING.text.toLowerCase().replaceAll("-", " "),
			account: "a",
			made: "b",
		});
		expect(text).toContain(`\n${ASCENDING.text}\n`);
	});

	it("refuses a key with a typo, so a bad key never lands in a file", () => {
		const typo = `${ASCENDING.text.slice(0, 5)}${ASCENDING.text[5] === "0" ? "1" : "0"}${ASCENDING.text.slice(6)}`;
		expect(
			code(() =>
				recoveryKeyFileText(labels, { keyText: typo, account: "a", made: "b" }),
			),
		).toBe("invalid_input");
	});
});
