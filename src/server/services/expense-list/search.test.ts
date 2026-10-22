import { describe, expect, it } from "vitest";
import {
	amountCandidates,
	decodeCursor,
	encodeCursor,
	FOLD_FROM,
	FOLD_TO,
	foldText,
	likePattern,
} from "./search";

describe("Activity search", () => {
	it("folds case and accents the way the SQL letter table does", () => {
		expect(foldText("Almacén Ñandú ÇA")).toBe("almacen nandu ca");
		expect([...FOLD_FROM]).toHaveLength([...FOLD_TO].length);
		// Every letter in the table folds in JS to what SQL translates it to.
		[...FOLD_FROM].forEach((c, i) => {
			expect(foldText(c)).toBe([...FOLD_TO][i]);
		});
	});

	it("escapes LIKE wildcards", () => {
		expect(likePattern(" 100%_ok ")).toBe("%100\\%\\_ok%");
	});

	it("reads typed amounts in both grouping styles", () => {
		expect(amountCandidates("64000")).toEqual(["64000"]);
		expect(amountCandidates("64.000").sort()).toEqual(["64.000", "64000"]);
		expect(amountCandidates("64,000").sort()).toEqual(["64.000", "64000"]);
		expect(amountCandidates("12,99")).toEqual(["1299", "12.99"]);
		expect(amountCandidates("1.234,50")).toContain("1234.50");
		expect(amountCandidates("netflix")).toEqual([]);
		expect(amountCandidates("12.")).toEqual([]);
	});

	it("round-trips a cursor and refuses a made-up one", () => {
		const key = {
			date: new Date("2026-10-05T03:00:00.000Z"),
			src: "p",
			id: "abc",
		};
		expect(decodeCursor(encodeCursor(key))).toEqual(key);
		expect(decodeCursor("not-a-cursor")).toBeNull();
		expect(
			decodeCursor(Buffer.from('["2026-10-05","x","a"]').toString("base64url")),
		).toBeNull();
	});
});
