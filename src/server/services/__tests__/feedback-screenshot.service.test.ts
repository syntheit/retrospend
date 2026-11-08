import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const row = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("~/server/db", () => ({
	db: { feedback: { findUnique: vi.fn(async () => row.value) } },
}));
vi.mock("~/server/storage", () => ({ getFileStream: vi.fn() }));
vi.mock("~/server/services/admin-access.service", () => ({
	recordAdminRead: vi.fn(),
}));

import { recordAdminRead } from "~/server/services/admin-access.service";
import { getFileStream } from "~/server/storage";
import { openFeedbackScreenshotAsAdmin } from "../feedback-screenshot.service";

beforeEach(() => {
	vi.clearAllMocks();
	row.value = { screenshotPath: "feedback/f1.webp", userId: "bob" };
	vi.mocked(getFileStream).mockResolvedValue(Readable.from(["x"]));
});

describe("openFeedbackScreenshotAsAdmin", () => {
	it("logs the read against the sender, not the admin", async () => {
		const stream = await openFeedbackScreenshotAsAdmin("admin-1", "f1");
		expect(stream).not.toBeNull();
		expect(recordAdminRead).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
			adminId: "admin-1",
			userId: "bob",
			action: "feedback_screenshot_viewed",
		});
	});

	it("logs nothing when there is no picture or the file is gone", async () => {
		row.value = { screenshotPath: null, userId: "bob" };
		expect(await openFeedbackScreenshotAsAdmin("a", "f1")).toBeNull();
		row.value = null;
		expect(await openFeedbackScreenshotAsAdmin("a", "f1")).toBeNull();
		row.value = { screenshotPath: "feedback/f1.webp", userId: "bob" };
		vi.mocked(getFileStream).mockRejectedValue(new Error("missing"));
		expect(await openFeedbackScreenshotAsAdmin("a", "f1")).toBeNull();
		expect(recordAdminRead).not.toHaveBeenCalled();
	});

	it("serves nothing and closes the file when the entry cannot be written", async () => {
		const stream = Readable.from(["x"]);
		vi.mocked(getFileStream).mockResolvedValue(stream);
		vi.mocked(recordAdminRead).mockRejectedValue(new Error("disk full"));
		await expect(openFeedbackScreenshotAsAdmin("a", "f1")).rejects.toThrow(
			"disk full",
		);
		expect(stream.destroyed).toBe(true);
	});
});
