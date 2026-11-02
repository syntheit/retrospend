import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import type { ProjectActionId } from "./projectActions";

/** The words of the project actions, from the mobile.projects.actions catalog. */
export function projectWords(
	t: ReturnType<typeof useTranslations<"mobile.projects.actions">>,
): Record<ProjectActionId, string> {
	return {
		"add-person": t("addPerson"),
		"share-project": t("share"),
		"project-settings": t("settings"),
		"restore-project": t("restore"),
		"archive-project": t("archive"),
		"delete-project": t("delete"),
	};
}

/**
 * Archive and restore for any project, from its page or its row: Archive asks
 * first (a native alert: no money moves) and ends with a toast that restores
 * it, since the API restores with the same write.
 */
export function useArchiveProject(onChanged: () => void) {
	const t = useTranslations("mobile.projects.actions");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();

	async function setStatus(
		id: string,
		status: "ACTIVE" | "ARCHIVED",
	): Promise<boolean> {
		if (!api) return false;
		try {
			await api.projects.update(
				{ id, status },
				{ context: { idempotencyKey: newClientId() } },
			);
			announceEntryChange();
			onChanged();
			return true;
		} catch {
			return false;
		}
	}

	async function doArchive(project: { id: string; name: string }) {
		if (!(await setStatus(project.id, "ARCHIVED"))) {
			toast.show({ message: t("archiveError") });
			return;
		}
		toast.show({
			message: t("archived", { name: project.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const ok = await setStatus(project.id, "ACTIVE");
					toast.show({
						message: ok
							? t("restored", { name: project.name })
							: t("restoreError"),
					});
				},
			},
		});
	}

	return {
		archive(project: { id: string; name: string }) {
			showAlert(t("archiveTitle", { name: project.name }), undefined, [
				{ text: tc("cancel"), style: "cancel" },
				{
					text: t("archiveConfirm"),
					style: "destructive",
					onPress: () => void doArchive(project),
				},
			]);
		},
		async restore(project: { id: string; name: string }) {
			const ok = await setStatus(project.id, "ACTIVE");
			toast.show({
				message: ok ? t("restored", { name: project.name }) : t("restoreError"),
			});
		},
	};
}
