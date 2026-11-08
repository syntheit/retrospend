import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	session: vi.fn(),
	enabled: vi.fn(),
	access: vi.fn(),
	userFind: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("~/env", () => ({
	env: { SIDECAR_URL: "http://sidecar:8080", WORKER_API_KEY: "key" },
}));
vi.mock("~/server/better-auth/web-session", () => ({
	getWebSession: mocks.session,
}));
vi.mock("~/server/db", () => ({
	db: {
		user: { findUnique: mocks.userFind },
		eventLog: { create: vi.fn() },
	},
}));
vi.mock("~/server/services/ai-access.service", () => ({
	AI_IMPORT_OFF_MESSAGE: "Turn on AI import in your settings first",
	isAiImportEnabled: mocks.enabled,
	resolveAiAccess: mocks.access,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function upload() {
	const form = new FormData();
	form.append("file", new File(["a,b"], "s.csv", { type: "text/csv" }));
	return new NextRequest("http://localhost/api/import/process", {
		method: "POST",
		body: form,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.session.mockResolvedValue({ user: { id: "user-1" } });
	mocks.userFind.mockResolvedValue({ isActive: true, aiMode: "LOCAL" });
	mocks.access.mockResolvedValue({ allowed: true, effectiveMode: "LOCAL" });
	mocks.fetch.mockResolvedValue(new Response("", { status: 200 }));
	vi.stubGlobal("fetch", mocks.fetch);
});

describe("POST /api/import/process", () => {
	it("refuses when AI import is off and sends nothing to the sidecar", async () => {
		mocks.enabled.mockResolvedValue(false);
		const res = await POST(upload());
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: "Turn on AI import in your settings first",
		});
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("refuses when the AI quota is used up", async () => {
		mocks.enabled.mockResolvedValue(true);
		mocks.access.mockResolvedValue({
			allowed: false,
			reason: "Monthly local AI token quota exceeded",
			effectiveMode: "LOCAL",
		});
		const res = await POST(upload());
		expect(res.status).toBe(429);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("forwards the file with the provider the account uses when it is on", async () => {
		mocks.enabled.mockResolvedValue(true);
		const res = await POST(upload());
		expect(res.status).toBe(200);
		const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
		expect((init.body as FormData).get("provider")).toBe("local");
	});
});
