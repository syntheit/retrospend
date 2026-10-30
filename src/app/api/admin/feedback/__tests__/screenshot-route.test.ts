import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/better-auth/web-session", () => ({ getWebSession: vi.fn() }));
vi.mock("~/server/services/feedback-screenshot.service", () => ({
	openFeedbackScreenshot: vi.fn(),
}));

import { getWebSession } from "~/server/better-auth/web-session";
import { openFeedbackScreenshot } from "~/server/services/feedback-screenshot.service";
import { GET } from "../[id]/screenshot/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () =>
	new Request("http://localhost/api/admin/feedback/f1/screenshot");
const as = (role: "ADMIN" | "USER") =>
	vi.mocked(getWebSession).mockResolvedValue({
		user: { id: "u1", role },
	} as never);

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(openFeedbackScreenshot).mockResolvedValue(
		Readable.from(["webp-bytes"]),
	);
});

describe("admin feedback screenshot route", () => {
	it("is a 401 without a web session and reads nothing", async () => {
		vi.mocked(getWebSession).mockResolvedValue(null);
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(401);
		expect(openFeedbackScreenshot).not.toHaveBeenCalled();
	});

	it("is a 403 for a signed-in member and reads nothing", async () => {
		as("USER");
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(403);
		expect(openFeedbackScreenshot).not.toHaveBeenCalled();
	});

	it("serves the picture to an admin, private and uncached", async () => {
		as("ADMIN");
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		expect(openFeedbackScreenshot).toHaveBeenCalledWith("f1");
	});

	it("is a 404 when there is no screenshot or the file is gone", async () => {
		as("ADMIN");
		vi.mocked(openFeedbackScreenshot).mockResolvedValue(null);
		expect((await GET(request(), params("f1"))).status).toBe(404);
	});
});
