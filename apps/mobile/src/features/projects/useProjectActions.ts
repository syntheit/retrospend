import { useEffect, useState } from "react";

import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import { canArchiveProject, canEditProject } from "./projectForm";
import type { ProjectPage } from "./source";

/**
 * Add person, Share, Settings, Archive, Restore and Delete for one project, as items
 * of its overflow menu, and `edit` for the header's pencil (it opens the
 * project sheet). Share opens the share sheet and Settings the settings sheet (switches and member dates). Archive asks first (a native alert: no money
 * moves) and ends with a toast that restores it, since the API restores with
 * the same write. What the role may not do is left out; the server checks it
 * again.
 */
export function useProjectActions(
	page: Pick<ProjectPage, "id" | "name" | "status" | "myRole">,
	onChanged: () => void,
	startAdding = false,
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
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const [editing, setEditing] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [configuring, setConfiguring] = useState(false);
	const [deleting, setDeleting] = useState(false);
	// A link or a project just made "with others" opens Add person at once.
	const [adding, setAdding] = useState(startAdding);
	useEffect(() => {
		if (startAdding) setAdding(true);
	}, [startAdding]);

	async function setStatus(status: "ACTIVE" | "ARCHIVED"): Promise<boolean> {
		if (!api) return false;
		try {
			await api.projects.update(
				{ id: page.id, status },
				{ context: { idempotencyKey: newClientId() } },
			);
			announceEntryChange();
			onChanged();
			return true;
		} catch {
			return false;
		}
	}

	async function archive() {
		if (!(await setStatus("ARCHIVED"))) {
			toast.show({ message: t("archiveError") });
			return;
		}
		toast.show({
			message: t("archived", { name: page.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const ok = await setStatus("ACTIVE");
					toast.show({
						message: ok
							? t("restored", { name: page.name })
							: t("restoreError"),
					});
				},
			},
		});
	}

	async function restore() {
		const ok = await setStatus("ACTIVE");
		toast.show({
			message: ok ? t("restored", { name: page.name }) : t("restoreError"),
		});
	}

	const items: MenuItem[] = [];
	if (canEditProject(page.myRole)) {
		items.push({
			id: "add-person",
			label: t("addPerson"),
			icon: "UserPlus",
			onPress: () => setAdding(true),
		});
	}
	if (canEditProject(page.myRole)) {
		items.push(
			{
				id: "share-project",
				label: t("share"),
				icon: "Share",
				onPress: () => setSharing(true),
			},
			{
				id: "project-settings",
				label: t("settings"),
				icon: "Settings",
				onPress: () => setConfiguring(true),
			},
		);
	}
	if (canArchiveProject(page.myRole)) {
		items.push(
			page.status === "ARCHIVED"
				? {
						id: "restore-project",
						label: t("restore"),
						icon: "ArchiveRestore",
						onPress: () => void restore(),
					}
				: {
						id: "archive-project",
						label: t("archive"),
						icon: "Archive",
						destructive: true,
						onPress: () =>
							showAlert(t("archiveTitle", { name: page.name }), undefined, [
								{ text: tc("cancel"), style: "cancel" },
								{
									text: t("archiveConfirm"),
									style: "destructive",
									onPress: () => void archive(),
								},
							]),
					},
		);
	}
	// Delete is quiet: the last item of the menu, red, and it previews first.
	if (canArchiveProject(page.myRole)) {
		items.push({
			id: "delete-project",
			label: t("delete"),
			icon: "Trash2",
			destructive: true,
			onPress: () => setDeleting(true),
		});
	}
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
