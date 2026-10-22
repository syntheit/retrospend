/**
 * The rollout flags against the real app_settings row: the M13 columns exist
 * with their OFF defaults, isFlagEnabled reads them, and the app role can
 * read but not change them.
 */
import { describe, expect, it } from "vitest";
import { isFlagEnabled } from "~/server/flags";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { createTestUser } from "~/test/pg-harness";

const admin = { role: "ADMIN" };
const user = { role: "USER" };

describe("rollout flags on Postgres", () => {
	it("defaults every flag to OFF on a fresh database", async () => {
		const settings = await getAppSettings();
		expect(settings).toMatchObject({ uiV2Mode: "OFF", apiV1Mode: "OFF" });

		for (const flag of ["uiV2", "apiV1", "envelopeBudget"] as const) {
			await expect(isFlagEnabled(flag, admin)).resolves.toBe(false);
		}
	});

	it("follows the stored modes", async () => {
		await updateAppSettings({ uiV2Mode: "ADMINS", apiV1Mode: "ALL" });

		await expect(isFlagEnabled("uiV2", admin)).resolves.toBe(true);
		await expect(isFlagEnabled("uiV2", user)).resolves.toBe(false);
		await expect(isFlagEnabled("apiV1", null)).resolves.toBe(true);
		// No column until the envelope books migration, so it stays OFF.
		await expect(isFlagEnabled("envelopeBudget", admin)).resolves.toBe(false);
	});

	it("lets the app role read the flags but not change them", async () => {
		const { db } = await createTestUser();
		const { uiV2Mode } = await getAppSettings();

		await expect(
			db.appSettings.findFirst({ select: { uiV2Mode: true } }),
		).resolves.toEqual({ uiV2Mode });
		await expect(
			db.appSettings.updateMany({ data: { uiV2Mode: "ALL" } }),
		).rejects.toThrow(/permission denied/);
	});
});
