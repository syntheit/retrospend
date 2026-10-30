import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

// The iPad sidebar's Insights destination (under Tools); phones open it from
// Home's spending.
export default function InsightsLayout() {
	const t = useTranslations("mobile.insights");
	return <TabStack title={t("title")} />;
}
