import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs in node with no DOM library, so the hooks are stubbed: the
// effect runs at once and the ref is a plain object.
const rendered = { locale: "en" };
vi.mock("next-intl", () => ({ useLocale: () => rendered.locale }));
vi.mock("react", () => ({
	useRef: (initial: unknown) => ({ current: initial }),
	useEffect: (effect: () => void) => effect(),
}));
const setLocaleCookie = vi.fn(async (_locale: string) => {});
vi.mock("./actions", () => ({
	setLocaleCookie: (locale: string) => setLocaleCookie(locale),
}));

import { LocaleSync } from "./locale-sync";

const reload = vi.fn();
const storage = new Map<string, string>();
const session = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, value),
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(dbLocale: string, cookieLocale: string | undefined) {
	LocaleSync({ dbLocale, cookieLocale });
	await flush();
}

describe("LocaleSync", () => {
	beforeEach(() => {
		rendered.locale = "en";
		setLocaleCookie.mockClear();
		reload.mockClear();
		storage.clear();
		vi.stubGlobal("window", { location: { reload }, sessionStorage: session });
	});

	it("sets a missing cookie without a reload when the page already matches", async () => {
		rendered.locale = "es-AR";
		await mount("es-AR", undefined);
		expect(setLocaleCookie).toHaveBeenCalledExactlyOnceWith("es-AR");
		expect(reload).not.toHaveBeenCalled();
	});

	it("reloads once when the page rendered in another language", async () => {
		rendered.locale = "en";
		await mount("de", undefined);
		expect(setLocaleCookie).toHaveBeenCalledExactlyOnceWith("de");
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("reloads when the cookie holds another language than the account", async () => {
		rendered.locale = "fr";
		await mount("de", "fr");
		expect(setLocaleCookie).toHaveBeenCalledWith("de");
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("normalizes a non-canonical stored value and does not throw", async () => {
		rendered.locale = "es-AR";
		await mount("es_AR", undefined);
		expect(setLocaleCookie).toHaveBeenCalledExactlyOnceWith("es-AR");
		expect(reload).not.toHaveBeenCalled();
	});

	it("does nothing when the cookie already holds the account's language", async () => {
		rendered.locale = "de";
		await mount("de", "de");
		expect(setLocaleCookie).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});

	it("falls back to the default for an unknown stored value", async () => {
		rendered.locale = "en";
		await mount("xx", undefined);
		expect(setLocaleCookie).toHaveBeenCalledExactlyOnceWith("en");
		expect(reload).not.toHaveBeenCalled();
	});

	it("does not reload again in the same tab when the cookie did not stick", async () => {
		rendered.locale = "en";
		await mount("de", undefined);
		await mount("de", undefined);
		expect(setLocaleCookie).toHaveBeenCalledTimes(2);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does not reload when session storage throws", async () => {
		rendered.locale = "en";
		vi.stubGlobal("window", {
			location: { reload },
			sessionStorage: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		});
		await mount("de", undefined);
		expect(reload).not.toHaveBeenCalled();
	});
});
