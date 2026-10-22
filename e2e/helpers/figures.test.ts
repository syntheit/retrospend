import { describe, expect, it, vi } from "vitest";
import {
	checkText,
	compareValues,
	FigureAudit,
	type FigureFetcher,
	type FigureTag,
	readTag,
	toleranceFor,
} from "./figures";

const ars = (id: string, minor: string, text: string): FigureTag => ({
	id,
	minor,
	currency: "ARS",
	unit: null,
	text,
});

/** A fake figures endpoint answering from a fixed table. */
function fixtureFetcher(
	table: Record<
		string,
		{ minor: string; currency?: string; unit?: "money" | "percent" | "count" }
	>,
): FigureFetcher {
	return vi.fn(async (ids: string[]) => ({
		figures: ids
			.filter((id) => id in table)
			.map((id) => {
				const row = table[id]!;
				return {
					id,
					unit: row.unit ?? "money",
					minor: row.minor,
					currency: row.currency,
				};
			}),
		missing: ids.filter((id) => !(id in table)),
	}));
}

describe("toleranceFor", () => {
	it("follows SYNTHESIS-r5: whole ARS ±1, foreign ±0.01, percent ±0.5, counts exact", () => {
		expect(toleranceFor("money", "ARS")).toBe(100n); // 1 peso in centavos
		expect(toleranceFor("money", "USD")).toBe(1n);
		expect(toleranceFor("money", "BRL")).toBe(1n);
		expect(toleranceFor("money", "JPY")).toBe(1n); // whole yen, no minor unit
		expect(toleranceFor("money", "KWD")).toBe(10n); // 0.01 in fils
		expect(toleranceFor("money", "BTC")).toBe(1_000_000n); // 0.01 in satoshis
		expect(toleranceFor("percent")).toBe(50n);
		expect(toleranceFor("count")).toBe(0n);
	});
});

describe("readTag", () => {
	it("reads money, percent and count tags", () => {
		expect(readTag(ars("owed.net", "-4110000", ""))).toEqual({
			id: "owed.net",
			unit: "money",
			minor: -4110000n,
			currency: "ARS",
		});
		expect(
			readTag({
				id: "budget.usedPct",
				minor: "4250",
				currency: null,
				unit: "percent",
				text: "",
			}),
		).toEqual({ id: "budget.usedPct", unit: "percent", minor: 4250n });
	});

	it("rejects tags that cannot be audited", () => {
		expect(readTag(ars("a,b", "1", ""))).toMatch(/bad data-figure/);
		expect(readTag(ars("spent", "12.5", ""))).toMatch(/not an integer/);
		expect(readTag(ars("spent", "", ""))).toMatch(/not an integer/);
		expect(
			readTag({
				id: "spent",
				minor: "1",
				currency: null,
				unit: null,
				text: "",
			}),
		).toMatch(/needs data-currency/);
		expect(readTag({ ...ars("spent", "1", ""), currency: "ars" })).toMatch(
			/bad data-currency/,
		);
	});
});

describe("checkText", () => {
	const value = (minor: bigint, currency = "ARS") => ({
		id: "spent",
		unit: "money" as const,
		minor,
		currency,
	});

	it("accepts whole pesos within one peso (es-AR grouping)", () => {
		// 1,234.49 ARS shown as "$ 1.234": 49 centavos off.
		expect(checkText(value(123449n), "$ 1.234", "es-AR")).toBeNull();
		// "$ 1.236" is 1.51 pesos off.
		expect(checkText(value(123449n), "$ 1.236", "es-AR")).toMatch(
			/shows "\$ 1.236"/,
		);
	});

	it("checks cents for foreign money (en-US)", () => {
		expect(checkText(value(-1250n, "USD"), "-US$12.50", "en-US")).toBeNull();
		expect(checkText(value(-1250n, "USD"), "US$12.51", "en-US")).toBeNull();
		expect(checkText(value(-1250n, "USD"), "US$12.52", "en-US")).toMatch(
			/data-minor is -1250/,
		);
	});

	it("fails a shown sign that disagrees with the value", () => {
		expect(checkText(value(-1250n, "USD"), "+US$12.50", "en-US")).toMatch(
			/value is negative/,
		);
		expect(checkText(value(1250n, "USD"), "−US$12.50", "en-US")).toMatch(
			/value is positive/,
		);
		expect(checkText(value(-4110000n), "ARS −41,100", "en-US")).toBeNull();
	});

	it("allows half the last shown digit on compact amounts", () => {
		// 1,234,567.89 ARS shown as "ARS 1.2M": 1.2M ± 0.05M.
		expect(checkText(value(123456789n), "ARS 1.2M", "en-US")).toBeNull();
		expect(checkText(value(123456789n), "ARS 1.3M", "en-US")).toMatch(
			/shows "ARS 1.3M"/,
		);
	});

	it("reads the locale's own separators", () => {
		const fr = new Intl.NumberFormat("fr-FR", {
			style: "currency",
			currency: "EUR",
		}).format(1234.56);
		expect(checkText(value(123456n, "EUR"), fr, "fr-FR")).toBeNull();
		expect(checkText(value(123456n, "EUR"), "1.234,56 €", "de-DE")).toBeNull();
	});

	it("checks percent to half a point and counts exactly", () => {
		const pct = (minor: bigint) => ({
			id: "p",
			unit: "percent" as const,
			minor,
		});
		expect(checkText(pct(4250n), "42.5%", "en-US")).toBeNull();
		expect(checkText(pct(4250n), "42,9 %", "es-AR")).toBeNull();
		expect(checkText(pct(4250n), "43.1%", "en-US")).toMatch(
			/data-minor is 4250/,
		);
		const count = { id: "rows", unit: "count" as const, minor: 12n };
		expect(checkText(count, "12 entries", "en-US")).toBeNull();
		expect(checkText(count, "13 entries", "en-US")).toMatch(/data-minor is 12/);
	});

	it("fails text without a number", () => {
		expect(checkText(value(0n), "No rate yet", "en-US")).toMatch(/no number/);
	});
});

describe("compareValues", () => {
	const money = (minor: bigint, currency = "ARS") => ({
		id: "x",
		unit: "money" as const,
		minor,
		currency,
	});

	it("treats opposite signs as a mismatch even inside the tolerance", () => {
		expect(compareValues(money(50n), money(-50n))).toMatch(/sign flipped/);
		expect(compareValues(money(0n), money(-50n))).toBeNull();
	});

	it("fails a different currency or unit", () => {
		expect(compareValues(money(100n), money(100n, "USD"))).toMatch(
			/currency USD vs ARS/,
		);
		expect(
			compareValues(money(100n), { id: "x", unit: "count", minor: 100n }),
		).toMatch(/unit count/);
	});
});

describe("FigureAudit", () => {
	it("passes a page whose figures match the API", async () => {
		const audit = new FigureAudit(
			fixtureFetcher({
				"owed.net": { minor: "-4110000", currency: "ARS" },
				"spent.month": { minor: "189520000", currency: "ARS" },
			}),
		);
		const problems = await audit.checkTags(
			"home",
			[
				ars("owed.net", "-4110000", "−ARS 41,100"),
				ars("spent.month", "189520049", "ARS 1,895,200"),
			],
			"en-US",
		);
		expect(problems).toEqual([]);
	});

	it("reports API mismatches, flipped signs and ids the API does not serve", async () => {
		const audit = new FigureAudit(
			fixtureFetcher({
				"owed.net": { minor: "4110000", currency: "ARS" },
				netWorth: { minor: "910000000", currency: "ARS" },
			}),
		);
		const problems = await audit.checkTags(
			"home",
			[
				ars("owed.net", "-4110000", "ARS 41,100"),
				ars("netWorth", "910020000", "ARS 9,100,200"),
				ars("budget.left", "100", "ARS 1"),
			],
			"en-US",
		);
		expect(problems).toEqual([
			"home: owed.net screen vs API: sign flipped: -4110000 ARS vs 4110000 ARS",
			"home: netWorth screen vs API: 910020000 ARS vs 910000000 ARS (tolerance 100)",
			"home: budget.left is not served by the figures API",
		]);
	});

	it("does not call the API for a page without figures", async () => {
		const fetcher = vi.fn<FigureFetcher>(async () => {
			throw new Error("no endpoint yet");
		});
		const audit = new FigureAudit(fetcher);
		expect(await audit.checkTags("settings", [], "en-US")).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("checks the same id across pages", async () => {
		const audit = new FigureAudit(
			fixtureFetcher({ "owed.net": { minor: "-4110000", currency: "ARS" } }),
		);
		await audit.checkTags(
			"home",
			[ars("owed.net", "-4110000", "ARS 41,100")],
			"en-US",
		);
		await audit.checkTags(
			"people",
			[ars("owed.net", "-4110050", "ARS 41,100")],
			"en-US",
		);
		await audit.checkTags(
			"wealth",
			[ars("owed.net", "-4120000", "ARS 41,200")],
			"en-US",
		);
		expect(audit.crossPage()).toEqual([
			"owed.net: wealth vs home: -4120000 ARS vs -4110000 ARS (tolerance 100)",
		]);
		expect(audit.figureCount).toBe(3);
	});

	it("reports bad tags and keeps checking the rest", async () => {
		const audit = new FigureAudit(
			fixtureFetcher({ "spent.month": { minor: "500000", currency: "ARS" } }),
		);
		const problems = await audit.checkTags(
			"activity",
			[
				ars("spent.month", "abc", "ARS 5,000"),
				ars("spent.month", "500000", "ARS 5,000"),
			],
			"en-US",
		);
		expect(problems).toEqual([
			'activity: spent.month: data-minor "abc" is not an integer',
		]);
	});
});
