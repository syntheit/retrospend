import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/better-auth/web-session", () => ({ getWebSession: vi.fn() }));
vi.mock("~/server/db", () => ({
	db: { feedback: { findUnique: vi.fn() } },
}));
vi.mock("~/server/storage", () => ({ getFileStream: vi.fn() }));

import { getWebSession } from "~/server/better-auth/web-session";
import { db } from "~/server/db";
import { getFileStream } from "~/server/storage";
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
	vi.mocked(db.feedback.findUnique).mockResolvedValue({
		screenshotPath: "feedback/f1.webp",
	} as never);
	vi.mocked(getFileStream).mockResolvedValue(Readable.from(["webp-bytes"]));
});

describe("admin feedback screenshot route", () => {
	it("is a 401 without a web session and reads nothing", async () => {
		vi.mocked(getWebSession).mockResolvedValue(null);
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(401);
		expect(db.feedback.findUnique).not.toHaveBeenCalled();
		expect(getFileStream).not.toHaveBeenCalled();
	});

	it("is a 403 for a signed-in member and reads nothing", async () => {
		as("USER");
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(403);
		expect(getFileStream).not.toHaveBeenCalled();
	});

	it("serves the picture to an admin, private and uncached", async () => {
		as("ADMIN");
		const res = await GET(request(), params("f1"));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		expect(getFileStream).toHaveBeenCalledWith("feedback/f1.webp");
	});

	it("is a 404 for an entry without a screenshot", async () => {
		as("ADMIN");
		vi.mocked(db.feedback.findUnique).mockResolvedValue({
			screenshotPath: null,
		} as never);
		expect((await GET(request(), params("f1"))).status).toBe(404);
	});

	it("is a 404 when the file is gone from storage", async () => {
		as("ADMIN");
		vi.mocked(getFileStream).mockRejectedValue(new Error("missing"));
		expect((await GET(request(), params("f1"))).status).toBe(404);
	});
});
