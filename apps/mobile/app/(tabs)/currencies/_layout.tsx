import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// A link into a page of this tab (a Home row, a notification) still has the
// tab's list under it, so the page shows the system back button.
export const unstable_settings = { anchor: "index" };

// The iPad sidebar's Currencies destination (the web's Tools group); phones
// open it from Settings.
export default function CurrenciesLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("currencies")} />;
}
