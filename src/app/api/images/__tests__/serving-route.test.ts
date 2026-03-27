import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("~/server/storage", () => ({
	getFileStream: vi.fn(),
}));

import { getFileStream } from "~/server/storage";
import { GET } from "../[...path]/route";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeParams(segments: string[]): { params: Promise<{ path: string[] }> } {
	return { params: Promise.resolve({ path: segments }) };
}

function makeRequest(): Request {
	return new Request("http://localhost/api/images/placeholder");
}

beforeEach(() => {
	vi.clearAllMocks();
	// Default: getFileStream returns a small readable stream
	vi.mocked(getFileStream).mockResolvedValue(Readable.from(["webp-bytes"]));
});

// ─── Valid requests ────────────────────────────────────────────────────────

describe("valid paths", () => {
	it("returns 200 with image/webp content-type for a .webp file", async () => {
		const res = await GET(makeRequest(), makeParams(["avatars", "u-123.webp"]));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
	});

	it("sets Cache-Control: public, immutable, max-age=31536000", async () => {
		const res = await GET(makeRequest(), makeParams(["avatars", "u-123.webp"]));
		const cc = res.headers.get("Cache-Control") ?? "";
		expect(cc).toContain("immutable");
		expect(cc).toContain("max-age=31536000");
		expect(cc).toContain("public");
	});

	it("returns correct content-type for .jpeg", async () => {
		const res = await GET(makeRequest(), makeParams(["receipts", "r-1.jpeg"]));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
	});

	it("returns correct content-type for .jpg", async () => {
		const res = await GET(makeRequest(), makeParams(["receipts", "r-1.jpg"]));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
	});

	it("returns correct content-type for .png", async () => {
		const res = await GET(makeRequest(), makeParams(["receipts", "r-1.png"]));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
	});

	it("passes the joined file path to getFileStream", async () => {
		await GET(makeRequest(), makeParams(["projects", "proj-abc-1234567890.webp"]));
		expect(vi.mocked(getFileStream)).toHaveBeenCalledWith(
			"projects/proj-abc-1234567890.webp",
		);
	});

	it("returns 404 when the file does not exist in storage", async () => {
		vi.mocked(getFileStream).mockRejectedValue(new Error("NoSuchKey"));
		const res = await GET(makeRequest(), makeParams(["avatars", "missing.webp"]));
		expect(res.status).toBe(404);
	});
});

// ─── Path traversal - SECURITY CRITICAL ───────────────────────────────────

describe("path traversal attacks → all must return 404", () => {
	const traversalCases: Array<{ label: string; segments: string[] }> = [
		{
			label: "../../../etc/passwd",
			segments: ["..", "..", "..", "etc", "passwd"],
		},
		{
			label: "avatars/../../etc/passwd",
			segments: ["avatars", "..", "..", "etc", "passwd"],
		},
		{
			label: "avatars/../../../secret",
			segments: ["avatars", "..", "..", "..", "secret"],
		},
		// Double-dot segments that survive join
		{ label: ".. only", segments: [".."] },
		{ label: ".. in middle", segments: ["avatars", "..", "secret"] },
	];

	for (const { label, segments } of traversalCases) {
		it(`rejects "${label}"`, async () => {
			const res = await GET(makeRequest(), makeParams(segments));
			expect(res.status).toBe(404);
			// Ensure storage was never called (path rejected before reaching it)
			expect(vi.mocked(getFileStream)).not.toHaveBeenCalled();
		});
	}
});

// ─── Invalid / dangerous characters ───────────────────────────────────────

describe("invalid characters in path → 404", () => {
	// The route regex [^a-zA-Z0-9\-_./] blocks anything outside the safe set.
	// These segments, once joined, contain forbidden chars.

	it("rejects path with null byte", async () => {
		const res = await GET(makeRequest(), makeParams(["avatars\x00", "x.webp"]));
		expect(res.status).toBe(404);
		expect(vi.mocked(getFileStream)).not.toHaveBeenCalled();
	});

	it("rejects path with tilde (~)", async () => {
		const res = await GET(makeRequest(), makeParams(["~root", "x.webp"]));
		expect(res.status).toBe(404);
	});

	it("rejects path with space", async () => {
		const res = await GET(makeRequest(), makeParams(["avatars", "my file.webp"]));
		expect(res.status).toBe(404);
	});

	it("rejects path with backslash", async () => {
		const res = await GET(makeRequest(), makeParams(["avatars\\etc", "x.webp"]));
		expect(res.status).toBe(404);
	});

	it("rejects empty path (no segments)", async () => {
		const res = await GET(makeRequest(), makeParams([]));
		expect(res.status).toBe(404);
	});

	it("rejects path starting with forward slash", async () => {
		// Next.js won't produce this in practice, but guard defensively
		const res = await GET(makeRequest(), makeParams(["/etc/passwd"]));
		expect(res.status).toBe(404);
	});

	it("rejects path with double-slash (//)", async () => {
		// Joined path would be "avatars//etc" which contains "//"
		const res = await GET(makeRequest(), makeParams(["avatars", "", "etc"]));
		expect(res.status).toBe(404);
	});

	it("rejects URL-encoded traversal (..%2F..%2Fetc)", async () => {
		// Next.js URL-decodes path segments before passing to the handler,
		// so %2F becomes "/" which makes the joined path contain ".."
		const res = await GET(makeRequest(), makeParams(["..%2F..%2Fetc", "passwd"]));
		expect(res.status).toBe(404);
	});
});
