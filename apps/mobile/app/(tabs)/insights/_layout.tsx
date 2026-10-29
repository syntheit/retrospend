import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// The iPad sidebar's Insights destination (under Tools); phones open it from
// Home's spending.
export default function InsightsLayout() {
	const t = useTranslations("mobile.insights");
	return <TabStack title={t("title")} />;
}
