import {
	CURRENCIES_APART,
	IPAD_SIDEBAR,
	PROJECTS_APART,
	RECURRING_APART,
} from "./destinations";

/**
 * Which tab-level routes are real tabs on this device. Only a screen declared
 * in the tabs layout is a tab: the bar holds Home, Activity, Budget, Wealth
 * and People, and the iPad sidebar adds Projects and Settings. A path that
 * names any other tab route lands on Home, so a link from outside the app
 * (a retrospend:// link, a web address) is mapped to where that screen lives
 * on a phone before the router sees it.
 */
export interface TabRouteFlags {
	projects: boolean;
	recurring: boolean;
	currencies: boolean;
	sidebar: boolean;
}

export const DEVICE_TAB_ROUTES: TabRouteFlags = {
	projects: PROJECTS_APART,
	recurring: RECURRING_APART,
	currencies: CURRENCIES_APART,
	sidebar: IPAD_SIDEBAR,
};

function withQuery(path: string, own: string, query: string): string {
	const rest = [own, query].filter(Boolean).join("&");
	return rest ? `${path}?${rest}` : path;
}

/** The route a link opens on this device: tab routes that are not tabs go to the screen that holds them. */
export function deviceRoute(
	path: string,
	flags: TabRouteFlags = DEVICE_TAB_ROUTES,
): string {
	const mark = path.indexOf("?");
	const pathname = mark < 0 ? path : path.slice(0, mark);
	const query = mark < 0 ? "" : path.slice(mark + 1);
	const [first, id, ...more] = pathname.split("/").filter(Boolean);
	if (first === "projects" && !flags.projects) {
		if (id && more.length === 0) {
			return withQuery(`/people/project/${id}`, "", query);
		}
		if (!id) return withQuery("/people", "segment=projects", query);
	}
	if (first === "recurring" && !flags.recurring && !id) {
		return withQuery("/activity", "segment=recurring", query);
	}
	if (first === "currencies" && !flags.currencies && !id) {
		return withQuery("/settings/currencies", "", query);
	}
	if (first === "preferences" && !flags.sidebar && !id) {
		return withQuery("/settings", "", query);
	}
	if (first === "insights" && !flags.sidebar && !id) {
		return withQuery("/home/insights", "", query);
	}
	return path;
}
