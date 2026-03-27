import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
// All mocks must be declared before importing the route handler so that
// the module graph resolves to mocks, never touching the real env / db / storage.

vi.mock("next/server", () => {
	class NextResponse extends Response {
		static json(data: unknown, init?: ResponseInit): NextResponse {
			const body = JSON.stringify(data);
			const headers = new Headers(init?.headers);
			if (!headers.has("Content-Type"))
				headers.set("Content-Type", "application/json");
			return new NextResponse(body, { ...init, headers });
		}
	}
	class NextRequest extends Request {}
	return { NextResponse, NextRequest };
});

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/server/db", () => ({
	db: {
		user: { findUnique: vi.fn(), update: vi.fn() },
	},
}));

vi.mock("~/server/storage", () => ({
	uploadFile: vi.fn(),
	deleteFile: vi.fn(),
	getImageUrl: vi.fn(),
}));

vi.mock("~/server/image-processing", () => ({
	processAvatar: vi.fn(),
}));

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { processAvatar } from "~/server/image-processing";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";
import { DELETE, POST } from "../avatar/route";

// ─── Test helpers ──────────────────────────────────────────────────────────

const USER_ID = "user-test-123";
const AVATAR_PATH = `avatars/${USER_ID}-1234567890.webp`;
const AVATAR_URL = `/api/images/${AVATAR_PATH}`;

/** Minimal JPEG magic bytes - processAvatar is mocked so content doesn't matter. */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeFile(
	buf: Buffer = JPEG_MAGIC,
	name = "photo.jpg",
	type = "image/jpeg",
): File {
	return new File([new Uint8Array(buf)], name, { type });
}

function makePostRequest(file: File): Request {
	const fd = new FormData();
	fd.append("file", file);
	return new Request("http://localhost/api/upload/avatar", {
		method: "POST",
		body: fd,
	});
}

function makeDeleteRequest(): Request {
	return new Request("http://localhost/api/upload/avatar", { method: "DELETE" });
}

function mockAuthedUser(): void {
	vi.mocked(auth.api.getSession).mockResolvedValue({
		user: { id: USER_ID, email: "test@example.com" },
		session: { id: "session-1" },
	} as never);
	vi.mocked(db.user.findUnique).mockResolvedValue({
		isActive: true,
		avatarPath: null,
	} as never);
	vi.mocked(db.user.update).mockResolvedValue({} as never);
}

function mockProcessedAvatar(): void {
	vi.mocked(processAvatar).mockResolvedValue(Buffer.from("mock-webp"));
	vi.mocked(uploadFile).mockResolvedValue(AVATAR_PATH);
	vi.mocked(getImageUrl).mockReturnValue(AVATAR_URL);
}

async function parseJson(res: Response): Promise<unknown> {
	return res.json();
}

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── POST /api/upload/avatar ───────────────────────────────────────────────

describe("POST /api/upload/avatar", () => {
	it("returns 401 when no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(401);
	});

	it("returns 401 when session has no user", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue({ user: null } as never);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(401);
	});

	it("returns 403 when user is not active", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue({
			user: { id: USER_ID },
		} as never);
		vi.mocked(db.user.findUnique).mockResolvedValue({ isActive: false } as never);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(403);
	});

	it("returns 400 when no file is provided", async () => {
		mockAuthedUser();
		const fd = new FormData(); // no "file" field
		const req = new Request("http://localhost/api/upload/avatar", {
			method: "POST",
			body: fd,
		});
		const res = await POST(req as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/no file/i);
	});

	it("returns 400 when file exceeds 5 MB", async () => {
		mockAuthedUser();
		const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB
		const res = await POST(makePostRequest(makeFile(largeBuffer)) as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/too large/i);
	});

	it("returns 400 and rejects PDF disguised as image (invalid magic bytes → processAvatar throws)", async () => {
		mockAuthedUser();
		// processAvatar is mocked - simulate it throwing for a bad file
		vi.mocked(processAvatar).mockRejectedValue(
			new Error("Invalid image format. Accepted formats: JPEG, PNG, WebP, GIF"),
		);
		const pdfBuf = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
		const res = await POST(makePostRequest(makeFile(pdfBuf)) as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/invalid image/i);
	});

	it("returns 200 with avatarUrl on successful upload (JPEG)", async () => {
		mockAuthedUser();
		mockProcessedAvatar();
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { avatarUrl: string };
		expect(body.avatarUrl).toBe(AVATAR_URL);
	});

	it("stored path follows 'avatars/{userId}-{timestamp}.webp' pattern", async () => {
		mockAuthedUser();
		mockProcessedAvatar();
		await POST(makePostRequest(makeFile()) as never);
		const calledPath = vi.mocked(uploadFile).mock.calls[0]![0];
		expect(calledPath).toMatch(/^avatars\/user-test-123-\d+\.webp$/);
	});

	it("uploads as image/webp regardless of original file extension", async () => {
		mockAuthedUser();
		mockProcessedAvatar();
		await POST(makePostRequest(makeFile(JPEG_MAGIC, "photo.png", "image/png")) as never);
		expect(vi.mocked(uploadFile)).toHaveBeenCalledWith(
			expect.stringMatching(/^avatars\//),
			expect.any(Buffer),
			"image/webp",
		);
	});

	it("deletes the old avatar after a successful replacement", async () => {
		mockAuthedUser();
		const OLD_PATH = "avatars/user-test-123-0000000000.webp";
		// Override findUnique to return an existing avatarPath
		vi.mocked(db.user.findUnique)
			.mockResolvedValueOnce({ isActive: true } as never) // auth check
			.mockResolvedValueOnce({ avatarPath: OLD_PATH } as never); // pre-upload read
		mockProcessedAvatar();

		await POST(makePostRequest(makeFile()) as never);

		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(OLD_PATH);
	});
});

// ─── DELETE /api/upload/avatar ─────────────────────────────────────────────

describe("DELETE /api/upload/avatar", () => {
	it("returns 401 when unauthenticated", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(401);
	});

	it("returns 200 and clears avatarPath when user has an avatar", async () => {
		mockAuthedUser();
		vi.mocked(db.user.findUnique)
			.mockResolvedValueOnce({ isActive: true } as never) // auth
			.mockResolvedValueOnce({ avatarPath: AVATAR_PATH } as never); // lookup
		vi.mocked(deleteFile).mockResolvedValue(undefined);

		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(200);
		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(AVATAR_PATH);
		expect(vi.mocked(db.user.update)).toHaveBeenCalledWith(
			expect.objectContaining({ data: { avatarPath: null } }),
		);
	});

	it("returns 200 (idempotent) when user has no avatar to delete", async () => {
		mockAuthedUser();
		vi.mocked(db.user.findUnique)
			.mockResolvedValueOnce({ isActive: true } as never) // auth
			.mockResolvedValueOnce({ avatarPath: null } as never); // lookup

		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(200);
		expect(vi.mocked(deleteFile)).not.toHaveBeenCalled();
	});
});
