import type { Href } from "expo-router";
import { projectRoute } from "./destinations";

// Where an expense, a person or a project opens. A detail opens inside the
// stack of the screen that asked for it, so Back returns to that screen (a
// Home row, the search results, the inbox) and never to another tab's list.
// Home has no detail pages of its own; its stack carries copies of the
// others' (`app/(tabs)/home/entry`, `person`, `project`). Every other tab
// owns its details already.

/** True for a screen inside Home's stack (its root, Search, the inbox, a detail opened from them). */
export function isHomePath(pathname: string): boolean {
	return (
		pathname === "/" || pathname === "/home" || pathname.startsWith("/home/")
	);
}

export function entryHref(id: string, home: boolean, row?: string): Href {
	return {
		pathname: home ? "/home/entry/[id]" : "/activity/[id]",
		params: row ? { id, row } : { id },
	} as Href;
}

export function personHref(
	type: string,
	id: string,
	home: boolean,
	extra: { settle?: string } = {},
): Href {
	return {
		pathname: home ? "/home/person/[type]/[id]" : "/people/[type]/[id]",
		params: { type, id, ...extra },
	} as Href;
}

export function projectHref(id: string, home: boolean): Href {
	if (!home) return projectRoute(id) as Href;
	return { pathname: "/home/project/[id]", params: { id } } as Href;
}
