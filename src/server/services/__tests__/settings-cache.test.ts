import { afterEach, describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn());
vi.mock("~/server/db", () => ({ db: { appSettings: { upsert } } }));

const row = (enableFeedback: boolean) => ({
	id: "app_settings_singleton",
	enableFeedback,
});

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
		upsert.mockResolvedValueOnce(row(false));
		const pages = await loadCopy();
		await expect(pages.getAppSettings()).resolves.toMatchObject({
			enableFeedback: false,
		});

		upsert.mockResolvedValueOnce(row(true));
		const routeHandler = await loadCopy();
		await routeHandler.updateAppSettings({ enableFeedback: true });

		await expect(pages.getAppSettings()).resolves.toMatchObject({
			enableFeedback: true,
		});
		expect(upsert).toHaveBeenCalledTimes(2);
	});
});
