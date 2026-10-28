import * as WebBrowser from "expo-web-browser";

// Pages that stay on the web for 0.5. Each opens in the in-app browser on the
// connected server, where the web asks you to sign in (the phone's session is
// a token, not a cookie).

export const WEB_PAGES = [
	{ id: "import", path: "/import" },
	{ id: "insights", path: "/activity/insights" },
	{ id: "currencies", path: "/currencies" },
	{ id: "developer", path: "/settings#developer" },
	{ id: "data", path: "/settings#data" },
	{ id: "security", path: "/settings#security" },
] as const;

export type WebPageId = (typeof WEB_PAGES)[number]["id"];

/** The address of a page on the connected server. */
export function webUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function openWebPage(baseUrl: string, path: string) {
	return WebBrowser.openBrowserAsync(webUrl(baseUrl, path));
}
