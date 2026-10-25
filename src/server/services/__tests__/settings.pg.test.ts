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
			enableFeedback: true,
			maxConcurrentImportJobs: 5,
		});

		expect(created).toMatchObject({
			enableFeedback: true,
			maxConcurrentImportJobs: 5,
			inviteOnlyEnabled: false,
			enableEmail: true,
		});
		await expect(
			adminDb.appSettings.findFirstOrThrow({
				select: { enableFeedback: true, maxConcurrentImportJobs: true },
			}),
		).resolves.toEqual({ enableFeedback: true, maxConcurrentImportJobs: 5 });
		await expect(getAppSettings()).resolves.toMatchObject({
			maxConcurrentImportJobs: 5,
		});
	});
});
