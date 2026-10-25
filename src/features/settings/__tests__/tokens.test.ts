import { describe, expect, it } from "vitest";
import {
	DEFAULT_EXPIRY,
	DEFAULT_SCOPES,
	expiryFrom,
	grantableScopes,
	isExpired,
	orderScopes,
	scopeKey,
	toToken,
} from "../developer/tokens";
import {
	deliveryStatus,
	eventResources,
	isWebhookUrl,
	stateOf,
	targetOf,
} from "../developer/webhooks";

const dto = {
	id: "k1",
	name: "Sync",
	start: "rsk_se",
	scopes: ["read" as const],
	enabled: true,
	createdAt: "2026-10-22T10:00:00Z",
	expiresAt: "2027-01-20T10:00:00Z",
	lastUsedAt: null,
};

describe("API tokens model", () => {
	it("turns the route's timestamps into dates", () => {
		const token = toToken(dto);
		expect(token.createdAt.toISOString()).toBe("2026-10-22T10:00:00.000Z");
		expect(token.expiresAt?.toISOString()).toBe("2027-01-20T10:00:00.000Z");
		expect(token.lastUsedAt).toBeNull();
		expect(token.scopes).toEqual(["read"]);
	});

	it("starts a new key at read access and 90 days", () => {
		expect(DEFAULT_SCOPES).toEqual(["read"]);
		expect(DEFAULT_EXPIRY).toBe(90);
	});

	it("offers admin access only to admins", () => {
		expect(grantableScopes(false)).not.toContain("admin");
		expect(grantableScopes(true)).toContain("admin");
		expect(grantableScopes(false)).toEqual([
			"read",
			"write:expenses",
			"write:money",
			"write:settings",
		]);
	});

	it("orders scopes as the contract does and names their message keys", () => {
		expect(orderScopes(["write:money", "read"])).toEqual([
			"read",
			"write:money",
		]);
		expect(scopeKey("write:expenses")).toBe("writeExpenses");
		expect(scopeKey("read")).toBe("read");
	});

	it("says when a key made now stops working", () => {
		const now = new Date("2026-10-22T12:00:00Z");
		expect(expiryFrom(30, now).toISOString()).toBe("2026-11-21T12:00:00.000Z");
	});

	it("is expired from its expiry time on, never without one", () => {
		const now = new Date("2026-10-22T12:00:00Z");
		const key = toToken({ ...dto, expiresAt: null });
		expect(isExpired(key, now)).toBe(false);
		expect(
			isExpired({ ...key, expiresAt: new Date("2026-10-22T12:00:00Z") }, now),
		).toBe(true);
		expect(
			isExpired({ ...key, expiresAt: new Date("2026-10-23T00:00:00Z") }, now),
		).toBe(false);
	});
});

describe("webhooks model", () => {
	it("lists every event resource once, as a filter the server accepts", () => {
		const list = eventResources();
		expect(list.length).toBeGreaterThan(20);
		expect(new Set(list.map((r) => r.resource)).size).toBe(list.length);
		for (const r of list) {
			expect(r.filter).toMatch(/^[a-z][a-z0-9_]*\.\*$/);
			expect(r.verbs.length).toBeGreaterThan(0);
		}
		const expense = list.find((r) => r.resource === "expense");
		expect(expense?.verbs).toContain("created");
	});

	it("groups verbs under their resource", () => {
		expect(
			eventResources(["a.created", "a.deleted", "b.moved", "nodot"]),
		).toEqual([
			{ resource: "a", filter: "a.*", verbs: ["created", "deleted"] },
			{ resource: "b", filter: "b.*", verbs: ["moved"] },
		]);
	});

	it("shows only the origin of a target", () => {
		expect(targetOf("https://hooks.example.com/secret/token?x=1")).toBe(
			"https://hooks.example.com",
		);
		expect(targetOf("not a url")).toBe("not a url");
	});

	it("accepts http and https addresses and nothing else", () => {
		expect(isWebhookUrl("https://example.com/hook")).toBe(true);
		expect(isWebhookUrl(" http://192.168.1.5:8080/x ")).toBe(true);
		expect(isWebhookUrl("ftp://example.com")).toBe(false);
		expect(isWebhookUrl("example.com")).toBe(false);
		expect(isWebhookUrl("")).toBe(false);
	});

	it("shows a word for a webhook that is off, and nothing while it works", () => {
		expect(stateOf({ enabled: true, disabledReason: null })).toEqual({
			kind: "active",
		});
		expect(stateOf({ enabled: false, disabledReason: "manual" })).toEqual({
			kind: "off",
			status: "notCounted",
			reason: "manual",
		});
		expect(
			stateOf({ enabled: false, disabledReason: "too_many_failures" }),
		).toMatchObject({ status: "error", reason: "failures" });
		expect(
			stateOf({ enabled: false, disabledReason: "blocked_target" }),
		).toMatchObject({ status: "error", reason: "blocked" });
	});

	it("maps delivery states to the one status map", () => {
		expect(deliveryStatus("succeeded")).toEqual({
			kind: "confirmed",
			word: "delivered",
		});
		expect(deliveryStatus("failed").kind).toBe("error");
		expect(deliveryStatus("pending").kind).toBe("pending");
	});
});
