import { router } from "expo-router";
import { PROJECTS_APART } from "@/layout/destinations";
import { projectHref } from "@/layout/detailRoutes";

/**
 * Opens a project; the name shows in the title while it loads. `settle`
 * opens Settle all, `add` opens Add person (a project just made "with
 * others"), `sheet` opens that sheet.
 */
export function openProject(
	project: { id: string; name: string },
	open: {
		settle?: boolean;
		add?: boolean;
		/** A sheet to open on the page (a row's menu: Share, Settings, Delete). */
		sheet?: "share" | "settings" | "delete";
	} = {},
	/** Opened from a screen in Home's stack (Search): the project opens there too. */
	home = false,
) {
	const params = {
		id: project.id,
		name: project.name,
		...(open.settle ? { settle: "1" } : {}),
		...(open.add ? { add: "person" } : {}),
		...(open.sheet ? { sheet: open.sheet } : {}),
	};
	if (home) {
		const base = projectHref(project.id, true) as { pathname: string };
		router.push({ pathname: base.pathname, params } as never);
		return;
	}
	router.push(
		PROJECTS_APART
			? { pathname: "/projects/[id]", params }
			: { pathname: "/people/project/[id]", params },
	);
}
