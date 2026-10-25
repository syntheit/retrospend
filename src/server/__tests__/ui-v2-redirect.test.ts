import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAppSettings = vi.hoisted(() => vi.fn());
const mockGetWebSession = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/settings", () => ({
	getAppSettings: mockGetAppSettings,
}));
vi.mock("~/server/better-auth/web-session", () => ({
	getWebSession: mockGetWebSession,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Like Next's redirect(): it throws, so the code after it never runs.
vi.mock("next/navigation", () => ({
	redirect: (to: string) => {
		throw new Error(`REDIRECT:${to}`);
	},
}));

// The pages render the old client pages; stand-ins keep this a routing test.
vi.mock("../../app/(dashboard)/dashboard/legacy-page", () => ({
	default: () => "legacy-dashboard",
}));
vi.mock("../../app/(dashboard)/transactions/legacy-page", () => ({
	default: () => "legacy-transactions",
}));
vi.mock("../../app/(dashboard)/recurring/legacy-page", () => ({
	default: () => "legacy-recurring",
}));

import DashboardPage from "../../app/(dashboard)/dashboard/page";
import RecurringPage from "../../app/(dashboard)/recurring/page";
import TransactionsPage from "../../app/(dashboard)/transactions/page";
import { isUiV2On, redirectIfUiV2, withQuery } from "../ui-v2-redirect";

function setFlag(mode: "OFF" | "ADMINS" | "ALL", role: "ADMIN" | "USER") {
	mockGetAppSettings.mockResolvedValue({ uiV2Mode: mode });
	mockGetWebSession.mockResolvedValue({ user: { role } });
}

describe("withQuery", () => {
	it("keeps the query of the old URL", () => {
		expect(withQuery("/activity", { q: "rent", month: "2026-10" })).toBe(
			"/activity?q=rent&month=2026-10",
		);
	});

	it("keeps repeated keys and drops undefined values", () => {
		expect(
			withQuery("/activity", { cat: ["a", "b"], gone: undefined }),
		).toBe("/activity?cat=a&cat=b");
	});

	it("adds no question mark when there is no query", () => {
		expect(withQuery("/home", {})).toBe("/home");
	});

	it("encodes values", () => {
		expect(withQuery("/activity", { q: "a&b c" })).toBe("/activity?q=a%26b+c");
	});
});

describe("redirectIfUiV2", () => {
	beforeEach(() => {
		mockGetAppSettings.mockReset();
		mockGetWebSession.mockReset();
	});

	it("returns without redirecting when uiV2 is OFF, even for an admin", async () => {
		setFlag("OFF", "ADMIN");
		await expect(
			redirectIfUiV2("/activity", Promise.resolve({})),
		).resolves.toBeUndefined();
		await expect(isUiV2On()).resolves.toBe(false);
	});

	it("redirects an admin when uiV2 is ADMINS, a member stays", async () => {
		setFlag("ADMINS", "ADMIN");
		await expect(redirectIfUiV2("/activity", Promise.resolve({}))).rejects.toThrow(
			"REDIRECT:/activity",
		);
		setFlag("ADMINS", "USER");
		await expect(
			redirectIfUiV2("/activity", Promise.resolve({})),
		).resolves.toBeUndefined();
	});

	it("redirects everyone when uiV2 is ALL", async () => {
		setFlag("ALL", "USER");
		await expect(redirectIfUiV2("/activity", Promise.resolve({}))).rejects.toThrow(
			"REDIRECT:/activity",
		);
	});
});

const ROUTES = [
	["/dashboard", DashboardPage, "/home", "legacy-dashboard"],
	["/transactions", TransactionsPage, "/activity", "legacy-transactions"],
	["/recurring", RecurringPage, "/activity/recurring", "legacy-recurring"],
] as const;

describe.each(ROUTES)("%s page", (_route, Page, target, legacy) => {
	beforeEach(() => {
		mockGetAppSettings.mockReset();
		mockGetWebSession.mockReset();
	});

	it("redirects to the new route with the query when uiV2 is on", async () => {
		setFlag("ALL", "USER");
		await expect(
			Page({ searchParams: Promise.resolve({ q: "rent", cat: ["a", "b"] }) }),
		).rejects.toThrow(`REDIRECT:${target}?q=rent&cat=a&cat=b`);
	});

	it("redirects without a query string when there is none", async () => {
		setFlag("ALL", "USER");
		await expect(
			Page({ searchParams: Promise.resolve({}) }),
		).rejects.toThrow(`REDIRECT:${target}`);
	});

	it("renders today's page unchanged when uiV2 is off", async () => {
		setFlag("OFF", "ADMIN");
		const element = await Page({ searchParams: Promise.resolve({ q: "x" }) });
		expect((element as { type: () => string }).type()).toBe(legacy);
	});

	it("renders today's page for a member while uiV2 is ADMINS only", async () => {
		setFlag("ADMINS", "USER");
		const element = await Page({ searchParams: Promise.resolve({}) });
		expect((element as { type: () => string }).type()).toBe(legacy);
	});
});
