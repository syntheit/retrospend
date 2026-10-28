import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// Wealth is a tab on every phone and in the iPad sidebar. Home's net worth line
// and Budget's link switch to it.
export default function WealthLayout() {
	const t = useTranslations("mobile.wealth");
	return <TabStack title={t("title")} />;
}
