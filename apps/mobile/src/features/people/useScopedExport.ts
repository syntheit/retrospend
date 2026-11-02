import { useTranslations } from "use-intl";
import { useDataExport } from "@/features/settings/security/useDataExport";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import type { PersonRef } from "./source";

/**
 * The overflow menu of a project, as the web's: its expenses as one CSV, the
 * settlement plan as a CSV (shared projects only) and the PDF. The server
 * builds the file and the share sheet opens when it is ready.
 */
export function useProjectExport(projectId: string, solo = false): MenuItem[] {
	const t = useTranslations("mobile.people");
	const failed = useTranslations("mobile.settings.data")("failed");
	const toast = useToast();
	const exporter = useDataExport();
	const item = (
		id: string,
		label: string,
		kind: "project_expenses" | "project_settlement_plan" | "project_pdf",
	): MenuItem => ({
		id,
		label,
		icon: "Download",
		onPress: () => {
			if (exporter.busy) return;
			void exporter.run({ kind, projectId }).then((ok) => {
				if (!ok) toast.show({ message: failed });
			});
		},
	});
	return [
		item("export-project", t("exportExpenses"), "project_expenses"),
		...(solo
			? []
			: [item("export-plan", t("exportPlan"), "project_settlement_plan")]),
		item("export-project-pdf", t("exportProjectPdf"), "project_pdf"),
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
