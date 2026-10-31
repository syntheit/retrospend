import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("~/server/better-auth/web-session", () => ({
	getWebSession: vi.fn(),
}));

vi.mock("~/server/services/accounts/icon", () => ({
	uploadAccountIcon: vi.fn(),
}));

import { getWebSession } from "~/server/better-auth/web-session";
import { uploadAccountIcon } from "~/server/services/accounts/icon";
import { POST } from "../account-icon/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function post(fields: { file?: File | null; accountId?: string }): Request {
	const fd = new FormData();
	if (fields.file !== null)
		fd.append(
			"file",
			fields.file ??
				new File([new Uint8Array(JPEG)], "logo.jpg", { type: "image/jpeg" }),
		);
	if (fields.accountId) fd.append("accountId", fields.accountId);
	return new Request("http://localhost/api/upload/account-icon", {
		method: "POST",
		body: fd,
	});
}

function signedIn() {
	vi.mocked(getWebSession).mockResolvedValue({ user: { id: "u1" } } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("POST /api/upload/account-icon", () => {
	it("401 without a session", async () => {
		vi.mocked(getWebSession).mockResolvedValue(null);
		const res = await POST(post({ accountId: "a1" }) as never);
		expect(res.status).toBe(401);
	});

	it("403 for an inactive user", async () => {
		signedIn();
		vi.mocked(uploadAccountIcon).mockRejectedValueOnce(
			new TRPCError({ code: "FORBIDDEN", message: "Forbidden" }),
		);
		const res = await POST(post({ accountId: "a1" }) as never);
		expect(res.status).toBe(403);
	});

	it("400 without an account id or without a file", async () => {
		signedIn();
		expect((await POST(post({}) as never)).status).toBe(400);
		expect(
			(await POST(post({ accountId: "a1", file: null }) as never)).status,
		).toBe(400);
		expect(uploadAccountIcon).not.toHaveBeenCalled();
	});

	it("returns the stored image's URL", async () => {
		signedIn();
		vi.mocked(uploadAccountIcon).mockResolvedValue({
			kind: "IMAGE",
			value: "/api/images/accounts/a1-1.webp",
		});
		const res = await POST(post({ accountId: "a1" }) as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			imageUrl: "/api/images/accounts/a1-1.webp",
		});
		expect(uploadAccountIcon).toHaveBeenCalledWith(
			"u1",
			"a1",
			expect.any(Buffer),
		);
	});

	it("maps the service's refusals to 404 and 400", async () => {
		signedIn();
		vi.mocked(uploadAccountIcon).mockRejectedValueOnce(
			new TRPCError({ code: "NOT_FOUND", message: "Account not found" }),
		);
		expect((await POST(post({ accountId: "a1" }) as never)).status).toBe(404);
		vi.mocked(uploadAccountIcon).mockRejectedValueOnce(
			new TRPCError({ code: "BAD_REQUEST", message: "Invalid image format" }),
		);
		expect((await POST(post({ accountId: "a1" }) as never)).status).toBe(400);
	});
});
