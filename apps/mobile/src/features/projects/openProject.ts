import { router } from "expo-router";
import { PROJECTS_APART } from "@/layout/destinations";

/**
 * Opens a project; the name shows in the title while it loads. `settle`
 * opens Settle all, `add` opens Add person (a project just made "with
 * others").
 */
export function openProject(
	project: { id: string; name: string },
	open: { settle?: boolean; add?: boolean } = {},
) {
	const params = {
		id: project.id,
		name: project.name,
		...(open.settle ? { settle: "1" } : {}),
		...(open.add ? { add: "person" } : {}),
	};
	router.push(
		PROJECTS_APART
			? { pathname: "/projects/[id]", params }
			: { pathname: "/people/project/[id]", params },
	);
}
