import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// The iPad sidebar's Recurring destination; phones open it from Settings.
export default function RecurringLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("recurring")} />;
}
