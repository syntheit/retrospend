import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// The iPad sidebar's Settings destination. Its pages (categories, sessions
// and the rest) push the app/settings stack over the tabs, as on phones.
export default function PreferencesLayout() {
	const t = useTranslations("mobile.settings");
	return <TabStack title={t("title")} />;
}
