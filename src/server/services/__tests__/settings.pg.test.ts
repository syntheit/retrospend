import { afterAll, describe, expect, it } from "vitest";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { adminDb } from "~/test/pg-harness";

describe("updateAppSettings on Postgres", () => {
	// Test files share one database: leave no settings row behind, so the
	// next reader recreates the defaults.
	afterAll(async () => {
		await adminDb.appSettings.deleteMany();
	});

	it("keeps every field when it has to create the settings row", async () => {
		await adminDb.appSettings.deleteMany();

		const created = await updateAppSettings({
			apiV1Mode: "ADMINS",
			uiV2Mode: "ALL",
			enableFeedback: true,
		});

		expect(created).toMatchObject({
			apiV1Mode: "ADMINS",
			uiV2Mode: "ALL",
			enableFeedback: true,
			inviteOnlyEnabled: false,
			enableEmail: true,
		});
		await expect(
			adminDb.appSettings.findFirstOrThrow({
				select: { apiV1Mode: true, uiV2Mode: true },
			}),
		).resolves.toEqual({ apiV1Mode: "ADMINS", uiV2Mode: "ALL" });
		await expect(getAppSettings()).resolves.toMatchObject({
			apiV1Mode: "ADMINS",
		});
	});
});
