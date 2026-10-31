import { type Href, router } from "expo-router";
import { projectRoute } from "@/layout/destinations";
import type { Target } from "./rules";

/**
 * Opens what a notification or a push is about, over wherever the person is.
 * `push` keeps the inbox under an opened thing so Back returns to it; a push
 * tap navigates, because it arrives from outside the app.
 */
export function openTarget(target: Target, how: "push" | "navigate" = "push") {
	const go = (href: Href) =>
		how === "push" ? router.push(href) : router.navigate(href);
	switch (target.kind) {
		case "entry":
			go({ pathname: "/activity/[id]", params: { id: target.id } });
			return;
		case "activity":
			go("/activity");
			return;
		case "person":
			go({
				pathname: "/people/[type]/[id]",
				params: { type: target.type, id: target.id },
			});
			return;
		case "people":
			go("/people");
			return;
		case "project":
			go(projectRoute(target.id));
			return;
		case "home":
			go("/home");
			return;
	}
}
