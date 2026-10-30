import { useTranslations } from "use-intl";
import { useDataExport } from "@/features/settings/security/useDataExport";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";

/**
 * The overflow menu of People and Projects: the expenses as one CSV, through
 * the same export as Settings, Data. It ends in the share sheet.
 */
export function useExpensesExport(): MenuItem[] {
	const t = useTranslations("mobile.people");
	const failed = useTranslations("mobile.settings.data")("failed");
	const toast = useToast();
	const exporter = useDataExport();
	return [
		{
			id: "export-expenses",
			label: t("exportExpenses"),
			onPress: () => {
				if (exporter.busy) return;
				void exporter.run("expenses").then((ok) => {
					if (!ok) toast.show({ message: failed });
				});
			},
		},
	];
}
