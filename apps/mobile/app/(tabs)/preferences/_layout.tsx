import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

// The iPad sidebar's Settings destination. Its pages (categories, sessions
// and the rest) push the app/settings stack over the tabs, as on phones.
export default function PreferencesLayout() {
	const t = useTranslations("mobile.settings");
	return <TabStack title={t("title")} />;
}
