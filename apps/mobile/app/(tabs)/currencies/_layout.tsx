import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// The iPad sidebar's Currencies destination (the web's Tools group); phones
// open it from Settings.
export default function CurrenciesLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("currencies")} />;
}
