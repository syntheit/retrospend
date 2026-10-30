import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

export default function ProjectsLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("projects")} />;
}
