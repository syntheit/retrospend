import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	role: undefined as string | undefined,
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("~/server/better-auth/web-session", () => ({
	getWebSession: async () => ({ user: { role: mocks.role } }),
}));
vi.mock("../readout", () => ({ DeviceEngineReadout: () => null }));

import DeviceEnginePage from "../page";

afterEach(() => {
	vi.unstubAllEnvs();
	mocks.notFound.mockClear();
});

describe("who may open the device engine readout", () => {
	it("is a 404 for a member in production, and for nobody signed in", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.role = "USER";
		await expect(DeviceEnginePage()).rejects.toThrow("NEXT_NOT_FOUND");
		mocks.role = undefined;
		await expect(DeviceEnginePage()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(2);
	});

	it("opens for an admin in production and for anyone signed in in development", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.role = "ADMIN";
		await expect(DeviceEnginePage()).resolves.toBeDefined();
		vi.stubEnv("NODE_ENV", "development");
		mocks.role = "USER";
		await expect(DeviceEnginePage()).resolves.toBeDefined();
		expect(mocks.notFound).not.toHaveBeenCalled();
	});
});
