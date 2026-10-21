import { describe, expect, it, vi } from "vitest";
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
