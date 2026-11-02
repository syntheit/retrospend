import type { ActionDef } from "@/ui/actionRegistry";
import { canArchiveProject, canEditProject } from "./projectForm";

/**
 * What can be done to a project, in one place: the project page's overflow
 * and a project row's long-press menu read this order, Delete last. Edit is
 * the pencil on the page, not a menu item (R3); a row opens the project on a
 * tap.
 */
export type ProjectActionId =
	| "add-person"
	| "share-project"
	| "project-settings"
	| "restore-project"
	| "archive-project"
	| "delete-project";

export const PROJECT_ACTIONS: Record<
	ProjectActionId,
	ActionDef<ProjectActionId>
> = {
	"add-person": { id: "add-person", icon: "UserPlus" },
	"share-project": { id: "share-project", icon: "Share" },
	"project-settings": { id: "project-settings", icon: "Settings" },
	"restore-project": { id: "restore-project", icon: "ArchiveRestore" },
	"archive-project": {
		id: "archive-project",
		icon: "Archive",
		destructive: true,
	},
	"delete-project": {
		id: "delete-project",
		icon: "Trash2",
		destructive: true,
	},
};

/** A sheet named by a route's `then` parameter, or nothing. */
export function startOf(
	value: string | undefined,
): "share" | "settings" | "delete" | undefined {
	return value === "share" || value === "settings" || value === "delete"
		? value
		: undefined;
}

/** The actions the role may do on a project in its status; the server checks again. */
export function projectActionsOf(project: {
	status: "ACTIVE" | "ARCHIVED";
	myRole: string | null;
}): ProjectActionId[] {
	const ids: ProjectActionId[] = [];
	if (canEditProject(project.myRole)) {
		ids.push("add-person", "share-project", "project-settings");
	}
	if (canArchiveProject(project.myRole)) {
		ids.push(
			project.status === "ARCHIVED" ? "restore-project" : "archive-project",
			"delete-project",
		);
	}
	return ids;
}
