import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import { canArchiveProject, canEditProject } from "./projectForm";
import type { ProjectPage } from "./source";

/**
 * Edit, Archive and Restore for one project, as items of its overflow menu.
 * Edit opens the project sheet. Archive asks first (a native alert: no money
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
	editing: boolean;
	closeEdit: () => void;
	adding: boolean;
	closeAdd: () => void;
} {
	const t = useTranslations("mobile.projects.actions");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const [editing, setEditing] = useState(false);
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
			id: "edit-project",
			label: t("edit"),
			onPress: () => setEditing(true),
		});
	}
	if (canEditProject(page.myRole)) {
		items.push({
			id: "add-person",
			label: t("addPerson"),
			onPress: () => setAdding(true),
		});
	}
	if (canArchiveProject(page.myRole)) {
		items.push(
			page.status === "ARCHIVED"
				? {
						id: "restore-project",
						label: t("restore"),
						onPress: () => void restore(),
					}
				: {
						id: "archive-project",
						label: t("archive"),
						destructive: true,
						onPress: () =>
							Alert.alert(
								t("archiveTitle", { name: page.name }),
								t("archiveBody"),
								[
									{ text: tc("cancel"), style: "cancel" },
									{
										text: t("archiveConfirm"),
										style: "destructive",
										onPress: () => void archive(),
									},
								],
							),
					},
		);
	}
	return {
		items,
		editing,
		closeEdit: () => setEditing(false),
		adding,
		closeAdd: () => setAdding(false),
	};
}
