import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	apiKey: { create: vi.fn(), list: vi.fn(), delete: vi.fn() },
}));
vi.mock("~/lib/auth-client", () => ({ authClient: client }));

import {
	CREATABLE_SCOPES,
	createToken,
	isExpired,
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

describe("key expiry", () => {
	it("is expired from its expiry time on, never without one", () => {
		const now = new Date("2026-10-22T12:00:00Z");
		const key = toToken({ id: "k", createdAt: "2026-09-01" });
		expect(isExpired(key, now)).toBe(false);
		expect(
			isExpired({ ...key, expiresAt: new Date("2026-10-22T12:00:00Z") }, now),
		).toBe(true);
		expect(
			isExpired({ ...key, expiresAt: new Date("2026-10-23T00:00:00Z") }, now),
		).toBe(false);
	});
});
