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
// https://host/projects/ID?invite=LINK a person was sent) opens that project
// in the app; the project screen sends it to the web page when you are not in
// it (the guest join flow and the public page are web pages). A link to a
// route that is not a tab on this device (Projects, Recurring, Currencies,
// Settings, Insights) is mapped to the screen that holds it (layout/tabRoutes),
// because an undeclared tab route lands on Home.
//
// Web addresses also arrive as app links: iOS universal links and Android app
// links for retrospend.app and dev.retrospend.app (app.config.ts lists the
// hosts and WEB_LINK_PATHS the first path segments; the Next app serves the
// verification files). A server on any other domain is not verified, so its
// links keep opening the browser. A web address whose path is not one the app
// has a screen for (login, docs, the public pages) opens nothing here.
//
//   https://host/projects/ID?invite=LINK    that project (or its web page)
//   https://host/people/TYPE/ID             a person
//   https://host/entries/ID                 an expense, income or transfer
//   https://host/notifications              the inbox
//   https://host/home, /activity, /activity/recurring, /activity/insights,
//   /budget, /wealth                        the matching screen

export type AppLink =
	| { kind: "compose"; prefill: ComposerPrefill }
	| { kind: "pending" }
	| { kind: "route"; path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** The scheme and host of a web address: only its path says where it goes. */
const WEB_ORIGIN = /^https?:\/\/[^/?#]+/i;

/**
 * The first path segments a web address may open in the app, and the hosts
 * that are verified for them. app.config.ts cannot import this file, so it
 * writes both lists out; test/app-config.test.ts keeps them equal.
 */
export const WEB_LINK_PATHS = [
	"projects",
	"people",
	"entries",
	"notifications",
	"home",
	"activity",
	"budget",
	"wealth",
] as const;
export const WEB_LINK_HOSTS = ["retrospend.app", "dev.retrospend.app"] as const;

/** Scheme and leading slashes dropped: "retrospend://add?x=1" and "/add?x=1" both give "add?x=1". */
function pathOf(url: string): string {
	return url.replace(WEB_ORIGIN, "").replace(SCHEME, "").replace(/^\/+/, "");
}

export function routeForUrl(url: string): AppLink | null {
	const trimmed = url.trim();
	const rest = pathOf(trimmed);
	if (!rest) return null;
	const mark = rest.indexOf("?");
	const path = mark < 0 ? rest : rest.slice(0, mark);
	const query = mark < 0 ? "" : rest.slice(mark + 1);
	const segments = path.split("/").filter(Boolean);
	const [first, second] = segments;
	if (
		WEB_ORIGIN.test(trimmed) &&
		!(WEB_LINK_PATHS as readonly string[]).includes(first ?? "")
	) {
		return null;
	}
	const open = (to: string): AppLink => ({
		kind: "route",
		path: deviceRoute(query ? `${to}?${query}` : to),
	});
	if (first === "notifications" && segments.length === 1) {
		return open("/home/inbox");
	}
	// Web addresses name an entry as /entries/ID; the app's route is Activity's.
	if (first === "entries" && second && segments.length === 2) {
		return open(`/activity/${second}`);
	}
	// Activity's own sub-pages are screens, never an entry id.
	if (first === "activity" && second === "recurring" && segments.length === 2) {
		return open("/recurring");
	}
	if (first === "activity" && second === "insights" && segments.length === 2) {
		return open("/insights");
	}
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
		// Marked as a link, so a project you are not in opens its web page.
		const params = new URLSearchParams(query);
		params.set("link", "1");
		return {
			kind: "route",
			path: deviceRoute(`/${segments.join("/")}?${params}`),
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
