import { useEffect, useState } from "react";

import { useTranslations } from "use-intl";
import { menuOf } from "@/ui/actionRegistry";
import type { MenuItem } from "@/ui/types";
import {
	PROJECT_ACTIONS,
	type ProjectActionId,
	projectActionsOf,
} from "./projectActions";
import { canEditProject } from "./projectForm";
import type { ProjectPage } from "./source";
import { projectWords, useArchiveProject } from "./useArchiveProject";

/**
 * Add person, Share, Settings, Archive, Restore and Delete for one project, as items
 * of its overflow menu, and `edit` for the header's pencil (it opens the
 * project sheet). Share opens the share sheet and Settings the settings sheet (switches and member dates). Archive asks first (a native alert: no money
 * moves) and ends with a toast that restores it, since the API restores with
 * the same write. What the role may not do is left out; the server checks it
 * again.
 */
/** A sheet a row's menu asks the project page to open once it shows. */
export type ProjectStart = "share" | "settings" | "delete";

export function useProjectActions(
	page: Pick<ProjectPage, "id" | "name" | "status" | "myRole">,
	onChanged: () => void,
	startAdding = false,
	startWith?: ProjectStart,
): {
	items: MenuItem[];
	/** Opens the project sheet (the header's pencil); null where the role may not edit. */
	edit: (() => void) | null;
	editing: boolean;
	closeEdit: () => void;
	adding: boolean;
	closeAdd: () => void;
	sharing: boolean;
	closeShare: () => void;
	configuring: boolean;
	closeSettings: () => void;
	deleting: boolean;
	closeDelete: () => void;
} {
	const t = useTranslations("mobile.projects.actions");
	const [editing, setEditing] = useState(false);
	const [sharing, setSharing] = useState(startWith === "share");
	const [configuring, setConfiguring] = useState(startWith === "settings");
	const [deleting, setDeleting] = useState(startWith === "delete");
	// A link or a project just made "with others" opens Add person at once.
	const [adding, setAdding] = useState(startAdding);
	useEffect(() => {
		if (startAdding) setAdding(true);
	}, [startAdding]);

	const { archive, restore } = useArchiveProject(onChanged);
	const run: Record<ProjectActionId, () => void> = {
		"add-person": () => setAdding(true),
		"share-project": () => setSharing(true),
		"project-settings": () => setConfiguring(true),
		"restore-project": () => void restore(page),
		"archive-project": () => archive(page),
		// Delete is quiet: the last item of the menu, red, and it previews first.
		"delete-project": () => setDeleting(true),
	};
	const items = menuOf(
		projectActionsOf(page),
		PROJECT_ACTIONS,
		projectWords(t),
		run,
	);
	return {
		items,
		edit: canEditProject(page.myRole) ? () => setEditing(true) : null,
		editing,
		closeEdit: () => setEditing(false),
		adding,
		closeAdd: () => setAdding(false),
		sharing,
		closeShare: () => setSharing(false),
		configuring,
		closeSettings: () => setConfiguring(false),
		deleting,
		closeDelete: () => setDeleting(false),
	};
}
