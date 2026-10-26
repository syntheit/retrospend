import { EVENT_TYPES } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import en from "../../../../packages/i18n/messages/en/settingsV2.json";
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
	areaOfResource,
	areasOfFilters,
	DELIVERY_ERRORS,
	deliveryStatus,
	EVENT_AREAS,
	eventAreas,
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
	it("gives every event resource of the contract an area", () => {
		const resources = new Set(EVENT_TYPES.map((t) => t.split(".")[0] ?? ""));
		const orphans = [...resources].filter((r) => areaOfResource(r) === null);
		expect(orphans, "event resources with no area").toEqual([]);
	});

	it("names every area and every delivery error in the English catalog", () => {
		const dev = en.developer as {
			areas: Record<string, string>;
			deliveryError: Record<string, string>;
		};
		for (const id of Object.keys(EVENT_AREAS)) expect(dev.areas[id], id).toBeTruthy();
		for (const code of DELIVERY_ERRORS)
			expect(dev.deliveryError[code], code).toBeTruthy();
	});

	it("selects an area by the filters of all its resources, budget included", () => {
		const areas = eventAreas();
		const expenses = areas.find((a) => a.id === "expenses");
		expect(expenses?.filters).toEqual(["expense.*", "expenses.*"]);
		const budget = areas.find((a) => a.id === "budget");
		expect(budget?.filters).toContain("budget_envelope.*");
		expect(budget?.filters).toContain("budget.*");
		// No raw resource is its own entry: a resource shows under one area only.
		const all = areas.flatMap((a) => a.filters);
		expect(new Set(all).size).toBe(all.length);
	});

	it("folds a webhook's filters, exact or per resource, into area names", () => {
		expect(
			areasOfFilters(["payment.*", "expense.created", "expenses.*"]),
		).toEqual(["expenses", "payments"]);
		expect(areasOfFilters([])).toEqual([]);
		expect(areaOfResource("budget_whatever")).toBe("budget");
		expect(areaOfResource("admin_whatever")).toBe("admin");
		expect(areaOfResource("hologram")).toBeNull();
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
