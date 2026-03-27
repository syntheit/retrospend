import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

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
		user: { findUnique: vi.fn() },
		project: { findUnique: vi.fn(), update: vi.fn() },
	},
}));

vi.mock("~/server/storage", () => ({
	uploadFile: vi.fn(),
	deleteFile: vi.fn(),
	getImageUrl: vi.fn(),
}));

vi.mock("~/server/image-processing", () => ({
	processProjectImage: vi.fn(),
}));

vi.mock("~/server/services/shared-expenses/project-permissions", () => ({
	requireProjectRole: vi.fn(),
}));

vi.mock("~/server/services/shared-expenses/audit-log", () => ({
	logAudit: vi.fn(),
}));

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { processProjectImage } from "~/server/image-processing";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";
import { DELETE, POST } from "../project-image/route";

// ─── Test helpers ──────────────────────────────────────────────────────────

const USER_ID = "user-editor-456";
const PROJECT_ID = "proj-abc-789";
const IMAGE_PATH = `projects/${PROJECT_ID}-1234567890.webp`;
const IMAGE_URL = `/api/images/${IMAGE_PATH}`;

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeFile(buf: Buffer = JPEG_MAGIC): File {
	return new File([new Uint8Array(buf)], "banner.jpg", { type: "image/jpeg" });
}

function makePostRequest(file: File, projectId = PROJECT_ID): Request {
	const fd = new FormData();
	fd.append("file", file);
	fd.append("projectId", projectId);
	return new Request("http://localhost/api/upload/project-image", {
		method: "POST",
		body: fd,
	});
}

function makeDeleteRequest(projectId = PROJECT_ID): Request {
	return new Request(
		`http://localhost/api/upload/project-image?projectId=${projectId}`,
		{ method: "DELETE" },
	);
}

function mockAuthedUser(): void {
	vi.mocked(auth.api.getSession).mockResolvedValue({
		user: { id: USER_ID },
		session: { id: "session-1" },
	} as never);
	vi.mocked(db.user.findUnique).mockResolvedValue({ isActive: true } as never);
}

function mockAllowedRole(): void {
	// requireProjectRole resolves (does not throw) → user is allowed
	vi.mocked(requireProjectRole).mockResolvedValue(undefined as never);
}

function mockProcessedImage(): void {
	vi.mocked(processProjectImage).mockResolvedValue(Buffer.from("mock-webp"));
	vi.mocked(uploadFile).mockResolvedValue(IMAGE_PATH);
	vi.mocked(getImageUrl).mockReturnValue(IMAGE_URL);
	vi.mocked(db.project.findUnique).mockResolvedValue({
		imagePath: null,
	} as never);
	vi.mocked(db.project.update).mockResolvedValue({} as never);
}

async function parseJson(res: Response): Promise<unknown> {
	return res.json();
}

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── POST /api/upload/project-image ───────────────────────────────────────

describe("POST /api/upload/project-image", () => {
	it("returns 401 when no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
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

	it("returns 400 when projectId is missing from form data", async () => {
		mockAuthedUser();
		const fd = new FormData();
		fd.append("file", makeFile());
		// no projectId field
		const req = new Request("http://localhost/api/upload/project-image", {
			method: "POST",
			body: fd,
		});
		const res = await POST(req as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/projectId/i);
	});

	it("returns 403 when user is CONTRIBUTOR (below EDITOR threshold)", async () => {
		mockAuthedUser();
		vi.mocked(requireProjectRole).mockRejectedValue(
			new TRPCError({
				code: "FORBIDDEN",
				message: "Insufficient role: need EDITOR or above",
			}),
		);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(403);
	});

	it("returns 403 when user is VIEWER", async () => {
		mockAuthedUser();
		vi.mocked(requireProjectRole).mockRejectedValue(
			new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" }),
		);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(403);
	});

	it("returns 403 when user is not a project participant", async () => {
		mockAuthedUser();
		vi.mocked(requireProjectRole).mockRejectedValue(
			new TRPCError({ code: "FORBIDDEN", message: "Not a participant" }),
		);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(403);
	});

	it("returns 400 when file exceeds 10 MB", async () => {
		mockAuthedUser();
		mockAllowedRole();
		const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
		const res = await POST(makePostRequest(makeFile(largeBuffer)) as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/too large/i);
	});

	it("returns 400 when image processing fails (invalid format)", async () => {
		mockAuthedUser();
		mockAllowedRole();
		vi.mocked(processProjectImage).mockRejectedValue(
			new Error("Invalid image format. Accepted formats: JPEG, PNG, WebP, GIF"),
		);
		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(400);
		const body = (await parseJson(res)) as { error: string };
		expect(body.error).toMatch(/invalid image/i);
	});

	it("returns 200 with imageUrl on successful upload by EDITOR", async () => {
		mockAuthedUser();
		mockAllowedRole();
		mockProcessedImage();

		const res = await POST(makePostRequest(makeFile()) as never);
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { imageUrl: string };
		expect(body.imageUrl).toBe(IMAGE_URL);
	});

	it("stored path follows 'projects/{projectId}-{timestamp}.webp' pattern", async () => {
		mockAuthedUser();
		mockAllowedRole();
		mockProcessedImage();

		await POST(makePostRequest(makeFile()) as never);

		const calledPath = vi.mocked(uploadFile).mock.calls[0]![0];
		expect(calledPath).toMatch(
			new RegExp(`^projects/${PROJECT_ID}-\\d+\\.webp$`),
		);
	});

	it("original filename does not appear in the stored path", async () => {
		mockAuthedUser();
		mockAllowedRole();
		mockProcessedImage();

		// Upload with a distinctive original filename
		const file = new File([JPEG_MAGIC], "my-company-banner-2026.jpg", {
			type: "image/jpeg",
		});
		await POST(makePostRequest(file) as never);

		const calledPath = vi.mocked(uploadFile).mock.calls[0]![0];
		expect(calledPath).not.toContain("my-company-banner-2026");
	});

	it("deletes the previous image when replacing an existing one", async () => {
		mockAuthedUser();
		mockAllowedRole();
		const OLD_PATH = `projects/${PROJECT_ID}-0000000000.webp`;
		vi.mocked(db.project.findUnique).mockResolvedValue({
			imagePath: OLD_PATH,
		} as never);
		vi.mocked(processProjectImage).mockResolvedValue(Buffer.from("mock-webp"));
		vi.mocked(uploadFile).mockResolvedValue(IMAGE_PATH);
		vi.mocked(getImageUrl).mockReturnValue(IMAGE_URL);
		vi.mocked(db.project.update).mockResolvedValue({} as never);

		await POST(makePostRequest(makeFile()) as never);

		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(OLD_PATH);
	});
});

// ─── DELETE /api/upload/project-image ─────────────────────────────────────

describe("DELETE /api/upload/project-image", () => {
	it("returns 401 when unauthenticated", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(401);
	});

	it("returns 400 when projectId query param is missing", async () => {
		mockAuthedUser();
		mockAllowedRole();
		const req = new Request("http://localhost/api/upload/project-image", {
			method: "DELETE",
		});
		const res = await DELETE(req as never);
		expect(res.status).toBe(400);
	});

	it("returns 403 when user lacks EDITOR role", async () => {
		mockAuthedUser();
		vi.mocked(requireProjectRole).mockRejectedValue(
			new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" }),
		);
		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(403);
	});

	it("returns 200 and removes imagePath when image exists", async () => {
		mockAuthedUser();
		mockAllowedRole();
		vi.mocked(db.project.findUnique).mockResolvedValue({
			imagePath: IMAGE_PATH,
		} as never);
		vi.mocked(db.project.update).mockResolvedValue({} as never);
		vi.mocked(deleteFile).mockResolvedValue(undefined);

		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(200);
		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(IMAGE_PATH);
		expect(vi.mocked(db.project.update)).toHaveBeenCalledWith(
			expect.objectContaining({ data: { imagePath: null } }),
		);
	});

	it("returns 200 (idempotent) when project has no image", async () => {
		mockAuthedUser();
		mockAllowedRole();
		vi.mocked(db.project.findUnique).mockResolvedValue({
			imagePath: null,
		} as never);

		const res = await DELETE(makeDeleteRequest() as never);
		expect(res.status).toBe(200);
		expect(vi.mocked(deleteFile)).not.toHaveBeenCalled();
	});
});
