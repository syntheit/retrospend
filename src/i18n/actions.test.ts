import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

import { setLocaleCookie } from "./actions";

describe("setLocaleCookie", () => {
	beforeEach(() => set.mockClear());

	it("stores a canonical locale as is", async () => {
		await setLocaleCookie("pt-BR");
		expect(set).toHaveBeenCalledWith("locale", "pt-BR", expect.any(Object));
	});

	it.each([
		["es_AR", "es-AR"],
		["pt", "pt-BR"],
		["en-US", "en"],
		["DE", "de"],
	])("normalizes the stored value %s to %s without throwing", async (stored, expected) => {
		await setLocaleCookie(stored);
		expect(set).toHaveBeenCalledWith("locale", expected, expect.any(Object));
	});

	it("falls back to the default locale for an unknown value", async () => {
		await setLocaleCookie("xx");
		await setLocaleCookie("");
		expect(set).toHaveBeenNthCalledWith(1, "locale", "en", expect.any(Object));
		expect(set).toHaveBeenNthCalledWith(2, "locale", "en", expect.any(Object));
	});
});
