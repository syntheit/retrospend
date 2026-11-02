import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

// Wealth is a tab on every phone and in the iPad sidebar. Home's net worth line
// and Budget's link switch to it.
export default function WealthLayout() {
	const t = useTranslations("mobile.wealth");
	return <TabStack collapsing title={t("title")} />;
}
