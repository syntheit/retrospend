import { useTranslations } from "use-intl";
import { useDataExport } from "@/features/settings/security/useDataExport";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import type { PersonRef } from "./source";

/**
 * The overflow menu of a project: its expenses as one CSV. The server builds
 * the file and the share sheet opens when it is ready.
 */
export function useProjectExport(projectId: string): MenuItem[] {
	const t = useTranslations("mobile.people");
	const failed = useTranslations("mobile.settings.data")("failed");
	const toast = useToast();
	const exporter = useDataExport();
	return [
		{
			id: "export-project",
			label: t("exportExpenses"),
			onPress: () => {
				if (exporter.busy) return;
				void exporter
					.run({ kind: "project_expenses", projectId })
					.then((ok) => {
						if (!ok) toast.show({ message: failed });
					});
			},
		},
	];
}

/**
 * The overflow menu of a person: the history between you as a CSV and the
 * statement as a PDF, both through the share sheet.
 */
export function usePersonExport(person: PersonRef): MenuItem[] {
	const t = useTranslations("mobile.person");
	const failed = useTranslations("mobile.settings.data")("failed");
	const toast = useToast();
	const exporter = useDataExport();
	const run = (kind: "person_history" | "person_pdf") => () => {
		if (exporter.busy) return;
		void exporter
			.run({
				kind,
				participantType: person.type,
				participantId: person.id,
			})
			.then((ok) => {
				if (!ok) toast.show({ message: failed });
			});
	};
	return [
		{
			id: "export-history",
			label: t("exportHistory"),
			onPress: run("person_history"),
		},
		{
			id: "share-statement",
			label: t("shareStatement"),
			onPress: run("person_pdf"),
		},
	];
}
