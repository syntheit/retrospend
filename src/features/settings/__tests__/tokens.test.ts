import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	apiKey: { create: vi.fn(), list: vi.fn(), delete: vi.fn() },
	listSessions: vi.fn(),
	revokeSession: vi.fn(),
}));
vi.mock("~/lib/auth-client", () => ({ authClient: client }));

import {
	CREATABLE_SCOPES,
	createToken,
	devicesFrom,
	listTokens,
	orderScopes,
	scopeKey,
	toToken,
} from "../developer/tokens";

beforeEach(() => vi.clearAllMocks());

describe("API tokens seam", () => {
	it("creates read keys through the plugin, expiry in seconds", async () => {
		client.apiKey.create.mockResolvedValue({
			data: {
				id: "k1",
				key: "rsk_secret",
				name: "Sync",
				start: "rsk_se",
				permissions: { scopes: ["read"] },
				createdAt: "2026-10-22T10:00:00Z",
				expiresAt: "2027-01-20T10:00:00Z",
			},
			error: null,
		});
		const out = await createToken({
			name: "Sync",
			expiresInDays: 90,
			scopes: ["read"],
		});
		expect(client.apiKey.create).toHaveBeenCalledWith({
			name: "Sync",
			expiresIn: 90 * 86_400,
		});
		expect(out.key).toBe("rsk_secret");
		expect(out.token.scopes).toEqual(["read"]);
	});

	it("refuses scopes the server cannot set yet, before calling it", async () => {
		expect(CREATABLE_SCOPES).toEqual(["read"]);
		await expect(
			createToken({
				name: "x",
				expiresInDays: 30,
				scopes: ["read", "write:money"],
			}),
		).rejects.toThrow(/write:money/);
		expect(client.apiKey.create).not.toHaveBeenCalled();
	});

	it("lists keys newest first, dropping unknown scopes", async () => {
		client.apiKey.list.mockResolvedValue({
			data: {
				apiKeys: [
					{
						id: "a",
						name: "Old",
						createdAt: "2026-01-01T00:00:00Z",
						permissions: { scopes: ["read", "root"] },
					},
					{
						id: "b",
						name: "New",
						createdAt: "2026-10-01T00:00:00Z",
						permissions: null,
						lastRequest: "2026-10-02T00:00:00Z",
					},
				],
			},
			error: null,
		});
		const list = await listTokens();
		expect(list.map((k) => k.id)).toEqual(["b", "a"]);
		expect(list[1]?.scopes).toEqual(["read"]);
		expect(list[0]?.scopes).toEqual([]);
		expect(list[0]?.lastUsedAt?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
	});

	it("reads a row without expiry or use", () => {
		const t = toToken({ id: "x", createdAt: "2026-10-22T00:00:00Z" });
		expect(t).toMatchObject({
			name: "",
			start: null,
			expiresAt: null,
			lastUsedAt: null,
			scopes: [],
		});
	});

	it("orders scopes as the contract does and names their message keys", () => {
		expect(orderScopes(["write:money", "read"])).toEqual([
			"read",
			"write:money",
		]);
		expect(scopeKey("write:expenses")).toBe("writeExpenses");
		expect(scopeKey("read")).toBe("read");
	});
});

describe("approved devices", () => {
	it("keeps only device client sessions, newest first", () => {
		const rows = [
			{
				token: "web",
				clientId: null,
				createdAt: "2026-10-01",
				updatedAt: "2026-10-02",
			},
			{
				token: "mob",
				clientId: "retrospend-mobile",
				scopes: "read",
				createdAt: "2026-10-01",
				updatedAt: "2026-10-02",
			},
			{
				token: "cli",
				clientId: "retrospend-cli",
				scopes: "read write:expenses",
				createdAt: "2026-10-05",
				updatedAt: "2026-10-06",
			},
			{
				token: "mcp",
				clientId: "retrospend-mcp",
				scopes: "read",
				createdAt: "2026-10-09",
				updatedAt: "2026-10-09",
			},
		];
		const devices = devicesFrom(rows);
		expect(devices.map((d) => d.token)).toEqual(["mcp", "cli"]);
		expect(devices[1]?.scopes).toEqual(["read", "write:expenses"]);
	});
});
