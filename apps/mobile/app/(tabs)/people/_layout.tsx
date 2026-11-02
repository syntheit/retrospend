import { useTranslations } from "use-intl";
import { peopleTabsHeight } from "@/features/people/segment";
import { TabStack } from "@/layout/TabStack";
import { useTheme } from "@/theme";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

export default function PeopleLayout() {
	const t = useTranslations("mobile.tabs");
	const theme = useTheme();
	return (
		<TabStack
			collapsing
			footer={peopleTabsHeight(theme)}
			title={t("peopleSegment")}
		/>
	);
}
