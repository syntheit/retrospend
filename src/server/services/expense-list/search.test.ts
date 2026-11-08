import { describe, expect, it } from "vitest";
import {
	amountCandidates,
	decodeCursor,
	encodeCursor,
	FOLD_FROM,
	FOLD_TO,
	foldColumn,
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

	it("keeps Cyrillic letters SQL translate keeps, only lowercasing them", () => {
		expect(foldText("Чай")).toBe("чай");
		expect(foldText("Йогурт")).toBe("йогурт");
		expect(foldText("Ёлка")).toBe("ёлка");
		expect(foldText("ЧАЙ и кофе")).toBe("чай и кофе");
	});

	it("folds a decomposed accent typed in the query like the precomposed one", () => {
		expect(foldText("Almace\u0301n")).toBe("almacen");
	});

	it("folds a stored value as stored: no normalization, per-letter lowercase", () => {
		expect(foldColumn("Almacén")).toBe("almacen");
		// SQL translate saw the combining mark as its own character.
		expect(foldColumn("Almace\u0301n")).toBe("almace\u0301n");
		// lower() has no context: a final sigma stays sigma, I with dot is i.
		expect(foldColumn("ΟΔΟΣ")).toBe("οδοσ");
		expect(foldColumn("\u0130stanbul")).toBe("istanbul");
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
			created: new Date("2026-10-05T18:30:12.345Z"),
			src: "p",
			id: "abc",
		};
		expect(decodeCursor(encodeCursor(key))).toEqual(key);
		expect(decodeCursor("not-a-cursor")).toBeNull();
		expect(
			decodeCursor(Buffer.from('["2026-10-05","x","a"]').toString("base64url")),
		).toBeNull();
	});

	it("reads a cursor made before the creation time joined the key", () => {
		const old = Buffer.from('["2026-10-05T03:00:00.000Z","p","abc"]').toString(
			"base64url",
		);
		const key = decodeCursor(old);
		expect(key?.id).toBe("abc");
		// Later than any real entry, so the page starts at the day's top.
		expect(key?.created.getTime()).toBeGreaterThan(Date.UTC(3000, 0, 1));
	});
});
