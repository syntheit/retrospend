import { describe, expect, it } from "vitest";
import {
	BRANDS,
	brandBySlug,
	brandUsesOwnColor,
	isAccountIcon,
	monogramLetter,
} from "./index";

describe("bundled logos", () => {
	it("ships the common finance brands, each with a path and a six digit color", () => {
		for (const slug of [
			"revolut",
			"wise",
			"paypal",
			"n26",
			"mercadopago",
			"nubank",
			"binance",
			"coinbase",
		]) {
			expect(brandBySlug(slug), slug).toBeDefined();
		}
		for (const b of BRANDS) {
			expect(b.hex).toMatch(/^[0-9A-F]{6}$/i);
			expect(b.path.length).toBeGreaterThan(20);
		}
	});

	it("has no Argentine bank logos: Simple Icons does not carry them", () => {
		for (const slug of ["galicia", "santander", "bbva", "macro"]) {
			expect(brandBySlug(slug)).toBeUndefined();
		}
	});

	it("has no duplicate slugs", () => {
		expect(new Set(BRANDS.map((b) => b.slug)).size).toBe(BRANDS.length);
	});
});

describe("isAccountIcon", () => {
	it("accepts a known logo, a palette slot and an upload path", () => {
		expect(isAccountIcon("BRAND", "revolut")).toBe(true);
		expect(isAccountIcon("MONOGRAM", "avatar-3")).toBe(true);
		expect(isAccountIcon("IMAGE", "accounts/abc123-1730000000000.webp")).toBe(
			true,
		);
	});

	it("refuses anything else", () => {
		expect(isAccountIcon("BRAND", "nope")).toBe(false);
		expect(isAccountIcon("MONOGRAM", "red")).toBe(false);
		expect(isAccountIcon("MONOGRAM", "avatar-9")).toBe(false);
		expect(isAccountIcon("IMAGE", "accounts/../etc/passwd")).toBe(false);
		expect(isAccountIcon("IMAGE", "avatars/x.webp")).toBe(false);
		expect(isAccountIcon("IMAGE", "https://example.com/x.webp")).toBe(false);
		expect(isAccountIcon("OTHER", "revolut")).toBe(false);
		expect(isAccountIcon(null, null)).toBe(false);
	});
});

describe("monogramLetter", () => {
	it("is the first letter or digit, upper case", () => {
		expect(monogramLetter("  banco galicia")).toBe("B");
		expect(monogramLetter("ñandú")).toBe("Ñ");
		expect(monogramLetter("2nd fund")).toBe("2");
		expect(monogramLetter("- - -")).toBe("?");
	});
});

describe("brandUsesOwnColor", () => {
	it("keeps mid colors and swaps near black and near white for the text color", () => {
		expect(brandUsesOwnColor("0075EB")).toBe(true);
		expect(brandUsesOwnColor("000000")).toBe(false);
		expect(brandUsesOwnColor("FFFFFF")).toBe(false);
	});
});
