import { deviceRoute } from "@/layout/tabRoutes";
import type { ComposerPrefill } from "./prefill";
import { canonicalAmount } from "./prefill";

// Every surface (Quick Settings tile, Shortcuts, Controls, notifications,
// other apps) enters through the retrospend:// scheme and Expo Router. Two
// links are not screens: they open the composer.
//
//   retrospend://add?amount=12.50&currency=USD&title=Coffee&mode=income
//   retrospend://share    a share or Shortcut waits in the native hand-off
//
// A project link (retrospend://projects/ID, or the web address
// https://host/projects/ID?invite=LINK a person was sent) opens the shared
// page (app/shared/[id]): the project itself when you are in it, else the
// join step for an invite or the read-only page. A link to a
// route that is not a tab on this device (Projects, Recurring, Currencies,
// Settings, Insights) is mapped to the screen that holds it (layout/tabRoutes),
// because an undeclared tab route lands on Home.

export type AppLink =
	| { kind: "compose"; prefill: ComposerPrefill }
	| { kind: "pending" }
	| { kind: "route"; path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** The scheme and host of a web address: only its path says where it goes. */
const WEB_ORIGIN = /^https?:\/\/[^/?#]+/i;

/** Scheme and leading slashes dropped: "retrospend://add?x=1" and "/add?x=1" both give "add?x=1". */
function pathOf(url: string): string {
	return url.replace(WEB_ORIGIN, "").replace(SCHEME, "").replace(/^\/+/, "");
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
	if (first === "projects" && segments.length === 2) {
		// A project link goes through the shared page: a project you are in opens
		// as itself, one you are not opens the join step or the read-only page.
		// A web address names its server, which a guest with no connection needs.
		const params = new URLSearchParams(query);
		const origin = WEB_ORIGIN.exec(url.trim())?.[0];
		if (origin && !params.has("server")) params.set("server", origin);
		const rest = params.toString();
		return {
			kind: "route",
			path: `/shared/${segments[1]}${rest ? `?${rest}` : ""}`,
		};
	}
	return {
		kind: "route",
		path: deviceRoute(`/${segments.join("/")}${query ? `?${query}` : ""}`),
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
