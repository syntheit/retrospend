"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { ProjectTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useToast } from "~/components/ui/toast";
import { useProjectActions } from "~/features/projects/use-project-actions";
import { downloadCsv, downloadPdf } from "~/lib/format";
import { api } from "~/trpc/react";
import type { SheetState } from "./project-sheets";
import type { PageView } from "./types";

/**
 * The project page's overflow (the project entity's registry, R8): the
 * list's actions plus Share, Add person, Settle all and Settings (sheets on
 * this page) and the three exports. Add expense is the header's primary, so
 * the menu leaves it out.
 */
export function useProjectPageActions(
	view: PageView | undefined,
	open: (s: SheetState) => void,
): ActionHandlers<ProjectTarget> {
	const t = useTranslations("projectV2.toast");
	const toast = useToast();
	const router = useRouter();
	const byId = useCallback(
		() =>
			view && {
				id: view.id,
				name: view.name,
				currency: view.primaryCurrency,
				solo: view.solo,
				archived: view.status === "ARCHIVED",
				owner: view.myRole === "ORGANIZER",
			},
		[view],
	);
	const base = useProjectActions(byId, () => router.push("/projects"));
	const csv = api.exportData.exportProjectExpenses.useMutation();
	const plan = api.exportData.exportSettlementPlan.useMutation();
	const pdf = api.exportData.exportProjectPdf.useMutation();

	return useMemo(() => {
		const editor = view?.myRole === "ORGANIZER" || view?.myRole === "EDITOR";
		const viewer = view?.myRole === "VIEWER" || view?.myRole == null;
		const fail = () => toast.failed(t("exportFailed"));
		return {
			archive: base.archive,
			restore: base.restore,
			delete: base.delete,
			share: () => open({ kind: "share" }),
			// Viewers record nothing: no Settle all for them.
			...(viewer ? {} : { settleAll: () => open({ kind: "settleAll" }) }),
			...(editor
				? {
						addPerson: () => open({ kind: "addPerson" }),
						settings: () => open({ kind: "settings" }),
					}
				: {}),
			exportCsv: (x) =>
				csv
					.mutateAsync({ projectId: x.id, format: "csv" })
					.then((r) => downloadCsv(r.csv, r.filename))
					.catch(fail),
			exportPlan: (x) =>
				plan
					.mutateAsync({ projectId: x.id, format: "csv" })
					.then((r) => downloadCsv(r.csv, r.filename))
					.catch(fail),
			exportPdf: (x) =>
				pdf
					.mutateAsync({ projectId: x.id })
					.then((r) => downloadPdf(r.pdf, r.filename))
					.catch(fail),
		};
	}, [base, csv, open, pdf, plan, t, toast, view?.myRole]);
}
