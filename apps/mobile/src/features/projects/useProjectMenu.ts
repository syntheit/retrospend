import { useTranslations } from "use-intl";
import { menuOf } from "@/ui/actionRegistry";
import type { MenuItem } from "@/ui/types";
import {
	PROJECT_ACTIONS,
	type ProjectActionId,
	projectActionsOf,
} from "./projectActions";
import type { ProjectItem } from "./source";
import { projectWords, useArchiveProject } from "./useArchiveProject";

/**
 * The long-press menu of a project row or card, from the same registry as the
 * project page's overflow, same items and order, Delete last. Archive and
 * Restore run from the row (alert and Undo toast); the others open the
 * project with that sheet showing (`open`), where Delete previews what it
 * removes. One hook for the whole list, so a row costs no hooks of its own.
 */
export function useProjectMenu(
	open: (project: ProjectItem, then?: "share" | "settings" | "delete") => void,
	onChanged: () => void,
	/** Opens the project with Add person showing. */
	addPerson: (project: ProjectItem) => void,
): (project: ProjectItem) => MenuItem[] {
	const t = useTranslations("mobile.projects.actions");
	const { archive, restore } = useArchiveProject(onChanged);
	const words = projectWords(t);
	return (project) => {
		const run: Record<ProjectActionId, () => void> = {
			"add-person": () => addPerson(project),
			"share-project": () => open(project, "share"),
			"project-settings": () => open(project, "settings"),
			"restore-project": () => void restore(project),
			"archive-project": () => archive(project),
			"delete-project": () => open(project, "delete"),
		};
		return menuOf(projectActionsOf(project), PROJECT_ACTIONS, words, run);
	};
}
