import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_ICON_NAMES } from "@retrospend/domain/category-icons";
import { CURRENCIES } from "@retrospend/domain/currencies";
import { getCountryCodeFromCurrency } from "@retrospend/domain/currency-country";
import { FLAGS } from "./flags.generated";
import { GLYPHS } from "./glyphs.generated";

// The drawings are generated from the web's sources (scripts/generate-glyphs.mjs).
// These tests fail when a key or a currency was added without running it.
describe("generated drawings", () => {
	it("draws every category icon key and the control glyphs", () => {
		for (const name of [
			...CATEGORY_ICON_NAMES,
			"Check",
			"Coins",
			"Search",
			"X",
		]) {
			expect(GLYPHS[name]?.length).toBeGreaterThan(0);
		}
	});

	it("only uses shapes the Glyph component draws", () => {
		const known = new Set([
			"circle",
			"ellipse",
			"line",
			"path",
			"polygon",
			"polyline",
			"rect",
		]);
		for (const shapes of Object.values(GLYPHS)) {
			for (const [tag] of shapes) expect(known.has(tag)).toBe(true);
		}
	});

	it("holds the flag of every fiat currency the web draws one for", () => {
		const flagsDir = join(__dirname, "../../../../public/images/flags");
		for (const code of Object.keys(CURRENCIES)) {
			const country = getCountryCodeFromCurrency(code);
			if (!country) continue;
			let exists = true;
			try {
				readFileSync(join(flagsDir, `${country}.svg`));
			} catch {
				exists = false;
			}
			expect(Boolean(FLAGS[country])).toBe(exists);
		}
	});
});
