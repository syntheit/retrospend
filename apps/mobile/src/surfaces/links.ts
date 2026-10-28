import type { ComposerPrefill } from "./prefill";
import { canonicalAmount } from "./prefill";

// Every surface (Quick Settings tile, Shortcuts, Controls, notifications,
// other apps) enters through the retrospend:// scheme and Expo Router. Two
// links are not screens: they open the composer.
//
//   retrospend://add?amount=12.50&currency=USD&title=Coffee&mode=income
//   retrospend://share    a share or Shortcut waits in the native hand-off

export type AppLink =
	| { kind: "compose"; prefill: ComposerPrefill }
	| { kind: "pending" }
	| { kind: "route"; path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Scheme and leading slashes dropped: "retrospend://add?x=1" and "/add?x=1" both give "add?x=1". */
function pathOf(url: string): string {
	return url.replace(SCHEME, "").replace(/^\/+/, "");
}

export function routeForUrl(url: string): AppLink | null {
	const rest = pathOf(url.trim());
	if (!rest) return null;
	const mark = rest.indexOf("?");
	const path = mark < 0 ? rest : rest.slice(0, mark);
	const query = mark < 0 ? "" : rest.slice(mark + 1);
	const segments = path.split("/").filter(Boolean);
	const [first] = segments;
	if (first === "share" && segments.length === 1) return { kind: "pending" };
	if (first === "add" && segments.length === 1) {
		const params = new URLSearchParams(query);
		const amount = canonicalAmount(params.get("amount") ?? "");
		const currency = (params.get("currency") ?? "").toUpperCase();
		const title = (params.get("title") ?? "").trim();
		return {
			kind: "compose",
			prefill: {
				mode: params.get("mode") === "income" ? "income" : "expense",
				...(amount ? { amount } : {}),
				...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
				...(title ? { title } : {}),
			},
		};
	}
	return {
		kind: "route",
		path: `/${segments.join("/")}${query ? `?${query}` : ""}`,
	};
}

/**
 * Expo Router's +native-intent hook: the two composer links must not be read
 * as screens (SurfaceLinks opens the composer), so they land on the app's
 * start; every other link keeps its path.
 */
export function systemPath(path: string): string {
	const link = routeForUrl(path);
	if (!link) return "/";
	return link.kind === "route" ? link.path : "/";
}
