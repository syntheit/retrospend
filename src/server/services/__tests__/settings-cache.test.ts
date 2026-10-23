import { afterEach, describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn());
vi.mock("~/server/db", () => ({ db: { appSettings: { upsert } } }));

const row = (uiV2Mode: string) => ({ id: "app_settings_singleton", uiV2Mode });

/** A fresh copy of the module, as Next gives each server bundle. */
async function loadCopy() {
	vi.resetModules();
	return import("~/server/services/settings");
}

describe("the app settings cache", () => {
	afterEach(() => {
		delete (globalThis as { retrospendAppSettings?: unknown })
			.retrospendAppSettings;
		upsert.mockReset();
	});

	it("serves a write made through one module copy to every other copy", async () => {
		upsert.mockResolvedValueOnce(row("OFF"));
		const pages = await loadCopy();
		await expect(pages.getAppSettings()).resolves.toMatchObject({
			uiV2Mode: "OFF",
		});

		upsert.mockResolvedValueOnce(row("ALL"));
		const routeHandler = await loadCopy();
		await routeHandler.updateAppSettings({ uiV2Mode: "ALL" });

		await expect(pages.getAppSettings()).resolves.toMatchObject({
			uiV2Mode: "ALL",
		});
		expect(upsert).toHaveBeenCalledTimes(2);
	});
});
