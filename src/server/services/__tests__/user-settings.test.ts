import { describe, expect, it, vi } from "vitest";
import type { Page } from "~prisma";
import { DEFAULT_PAGE_SETTINGS, getPageSettings, updatePageSettings } from "../user-settings";

function dbWith(stored: unknown) {
	return {
		userPageSetting: {
			findUnique: vi.fn(async () => (stored === undefined ? null : { settings: stored })),
			upsert: vi.fn(async () => ({})),
		},
	};
}

describe("page settings parsing", () => {
	it("old widget dashboard rows (v1 widgets, v2 layout) fall back to the default", async () => {
		const v2 = dbWith({ version: 2, layout: [{ id: "x", visible: true, size: "sm", order: 0 }] });
		const v1 = dbWith({ version: 1, widgets: { monthlyPacing: { visible: true } } });

		await expect(getPageSettings(v2 as never, "u", "DASHBOARD")).resolves.toEqual({ version: 1 });
		await expect(getPageSettings(v1 as never, "u", "DASHBOARD")).resolves.toEqual({ version: 1 });
		expect(v1.userPageSetting.upsert).not.toHaveBeenCalled();
	});

	it("each page keeps its own stored fields", async () => {
		const table = dbWith({ version: 1, pageSize: 50, showDescriptions: false });
		const expense = dbWith({ version: 1, defaultCurrency: "ARS", showExchangeRates: false });

		await expect(getPageSettings(table as never, "u", "TABLE")).resolves.toEqual({
			version: 1,
			pageSize: 50,
			showDescriptions: false,
		});
		await expect(getPageSettings(expense as never, "u", "EXPENSE")).resolves.toEqual({
			version: 1,
			defaultCurrency: "ARS",
			showExchangeRates: false,
		});
	});

	it("a stored row that does not fit its page falls back to the page default", async () => {
		const broken = dbWith({ version: 1, pageSize: "lots" });

		await expect(getPageSettings(broken as never, "u", "TABLE")).resolves.toEqual(
			DEFAULT_PAGE_SETTINGS.TABLE,
		);
	});

	it("updates validate against the page's schema", async () => {
		const db = dbWith(undefined);

		await expect(
			updatePageSettings(db as never, "u", "TABLE", { pageSize: 5 } as never),
		).rejects.toThrow();
		await expect(
			updatePageSettings(db as never, "u", "TABLE", { pageSize: 25 } as never),
		).resolves.toMatchObject({ pageSize: 25, showDescriptions: true });
	});
});

describe("stored page settings rows", () => {
	const pages = Object.keys(DEFAULT_PAGE_SETTINGS) as Page[];

	it.each(pages)("%s reads back a stored copy of its default", async (page) => {
		const stored = JSON.parse(JSON.stringify(DEFAULT_PAGE_SETTINGS[page]));
		await expect(getPageSettings(dbWith(stored) as never, "u", page)).resolves.toEqual(
			DEFAULT_PAGE_SETTINGS[page],
		);
	});

	it("drops keys a page no longer uses and keeps the rest", async () => {
		const budget = dbWith({
			version: 1,
			showRolloverAmounts: false,
			showPegToActual: true,
			showChart: true,
		});

		await expect(getPageSettings(budget as never, "u", "BUDGET")).resolves.toEqual({
			version: 1,
			showRolloverAmounts: false,
			showPegToActual: true,
		});
	});

	it("reads analytics category preferences keyed by category id", async () => {
		const analytics = dbWith({
			version: 1,
			categoryPreferences: {
				cat_a: { isFlexible: true },
				cat_b: { isFlexible: false, legacy: 1 },
			},
		});

		await expect(getPageSettings(analytics as never, "u", "ANALYTICS")).resolves.toEqual({
			version: 1,
			categoryPreferences: {
				cat_a: { isFlexible: true },
				cat_b: { isFlexible: false },
			},
		});
	});

	it("falls back to the default for rows that are missing fields or are not objects", async () => {
		const cases: [Page, unknown][] = [
			["WEALTH", { version: 1, showCurrencyExposure: false }],
			["ANALYTICS", { version: 1, categoryPreferences: { cat_a: { isFlexible: "yes" } } }],
			["EXPENSE", { version: 1, defaultCurrency: "EURO", showExchangeRates: true }],
			["TABLE", { version: 2, pageSize: 25, showDescriptions: true }],
			["TABLE", null],
			["TABLE", "settings"],
			["TABLE", []],
		];

		for (const [page, stored] of cases) {
			await expect(getPageSettings(dbWith(stored) as never, "u", page)).resolves.toEqual(
				DEFAULT_PAGE_SETTINGS[page],
			);
		}
	});
});
