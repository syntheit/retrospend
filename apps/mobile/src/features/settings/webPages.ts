import * as WebBrowser from "expo-web-browser";

// Pages that open in the in-app browser on the connected server, where the web
// asks you to sign in (the phone's session is a token, not a cookie). Only
// what must finish on the web (two-factor, the email change) and the plain
// reading pages (privacy, terms, docs, release notes) go there; a feature the
// app does not have is not offered.

/** The address of a page on the connected server. */
export function webUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function openWebPage(baseUrl: string, path: string) {
	return WebBrowser.openBrowserAsync(webUrl(baseUrl, path));
}
