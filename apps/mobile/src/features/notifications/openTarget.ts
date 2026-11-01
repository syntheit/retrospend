import { type Href, router } from "expo-router";
import { entryHref, personHref, projectHref } from "@/layout/detailRoutes";
import type { Target } from "./rules";

/**
 * Opens what a notification or a push is about, over wherever the person is.
 * `push` keeps the inbox under an opened thing so Back returns to it; a push
 * tap navigates, because it arrives from outside the app.
 */
export function openTarget(
	target: Target,
	how: "push" | "navigate" = "push",
	/** Opened from the inbox, which is in Home's stack: the thing opens there too. */
	home = false,
) {
	const go = (href: Href) =>
		how === "push" ? router.push(href) : router.navigate(href);
	switch (target.kind) {
		case "entry":
			go(entryHref(target.id, home));
			return;
		case "activity":
			go("/activity");
			return;
		case "person":
			go(personHref(target.type, target.id, home));
			return;
		case "people":
			go("/people");
			return;
		case "project":
			go(projectHref(target.id, home));
			return;
		case "home":
			go("/home");
			return;
	}
}
