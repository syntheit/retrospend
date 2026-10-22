import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAppSettings = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/settings", () => ({
	getAppSettings: mockGetAppSettings,
}));

import { type FlagViewer, isFlagEnabled } from "~/server/flags";

const viewers: Record<string, FlagViewer> = {
	admin: { role: "ADMIN" },
	user: { role: "USER" },
	"signed out": null,
};

// mode -> who sees the flag, in the order admin, user, signed out
const matrix = {
	OFF: [false, false, false],
	ADMINS: [true, false, false],
	ALL: [true, true, true],
} as const;

describe("isFlagEnabled", () => {
	beforeEach(() => {
		mockGetAppSettings.mockReset();
	});

	for (const [flag, column] of [
		["uiV2", "uiV2Mode"],
		["apiV1", "apiV1Mode"],
		["envelopeBudget", "envelopeBudgetMode"],
	] as const) {
		for (const [mode, expected] of Object.entries(matrix)) {
			for (const [i, [name, viewer]] of Object.entries(viewers).entries()) {
				it(`${flag} ${mode} for ${name} is ${expected[i]}`, async () => {
					mockGetAppSettings.mockResolvedValue({ [column]: mode });
					await expect(isFlagEnabled(flag, viewer)).resolves.toBe(expected[i]);
				});
			}
		}
	}

	it("reads a flag without a column yet as OFF, even for admins", async () => {
		mockGetAppSettings.mockResolvedValue({ uiV2Mode: "ALL", apiV1Mode: "ALL" });
		await expect(
			isFlagEnabled("envelopeBudget", { role: "ADMIN" }),
		).resolves.toBe(false);
	});

	it("reads each flag from its own column", async () => {
		mockGetAppSettings.mockResolvedValue({ uiV2Mode: "ALL", apiV1Mode: "OFF" });
		await expect(isFlagEnabled("uiV2", null)).resolves.toBe(true);
		await expect(isFlagEnabled("apiV1", { role: "ADMIN" })).resolves.toBe(
			false,
		);
	});
});
