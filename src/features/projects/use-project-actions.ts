"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ProjectTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useEntryActions } from "~/features/entry/entry-actions";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

/** What a project action needs beyond its registry target. */
export type ProjectActionSource = {
	id: string;
	name: string;
	currency: string;
	solo: boolean;
	archived: boolean;
	owner: boolean;
};

export const targetOf = (p: ProjectActionSource): ProjectTarget => ({
	id: p.id,
	name: p.name,
	solo: p.solo,
	archived: p.archived,
	owner: p.owner,
});

/**
 * The project entity's actions (R8) for the list and the project page:
 * Add expense, Share link, Settle all (opens the project's Summary with the
 * Settle all sheet), Archive and Restore (each with Undo), Delete (named
 * confirm). Pin has no server yet, so it has no handler and stays hidden.
 */
export function useProjectActions(
	byId: (id: string) => ProjectActionSource | undefined,
	onDeleted?: () => void,
) {
	const t = useTranslations("projectsV2.toast");
	const toast = useToast();
	const router = useRouter();
	const utils = api.useUtils();
	const { openNewExpense } = useEntryActions();
	const refresh = () => utils.project.invalidate();
	const update = api.project.update.useMutation({ onSuccess: refresh });
	const remove = api.project.delete.useMutation({ onSuccess: refresh });

	return useMemo<ActionHandlers<ProjectTarget>>(() => {
		const setStatus = async (x: ProjectTarget, archived: boolean) => {
			const status = archived ? "ARCHIVED" : "ACTIVE";
			const back = archived ? "ACTIVE" : "ARCHIVED";
			try {
				await update.mutateAsync({ id: x.id, status });
			} catch {
				toast.failed(t("failed"));
				return;
			}
			toast.saved(t(archived ? "archived" : "restored", { name: x.name }), {
				undo: () => update.mutateAsync({ id: x.id, status: back }),
			});
		};
		return {
			addExpense: (x) => {
				const p = byId(x.id);
				openNewExpense({
					projectId: x.id,
					projectName: x.name,
					projectDefaultCurrency: p?.currency,
					isSolo: x.solo,
				});
			},
			share: async (x) => {
				await navigator.clipboard.writeText(
					`${window.location.origin}/projects/${x.id}`,
				);
				toast.info(t("linkCopied"));
			},
			settleAll: (x) => router.push(`/projects/${x.id}?tab=summary&settle=all`),
			archive: (x) => setStatus(x, true),
			restore: (x) => setStatus(x, false),
			delete: async (x) => {
				try {
					await remove.mutateAsync({ id: x.id });
				} catch {
					toast.failed(t("failed"));
					return;
				}
				toast.saved(t("deleted", { name: x.name }));
				onDeleted?.();
			},
		};
	}, [byId, onDeleted, openNewExpense, remove, router, t, toast, update]);
}
