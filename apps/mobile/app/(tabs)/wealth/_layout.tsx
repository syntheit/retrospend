import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

// The iPad sidebar's own Wealth destination. On iPhone and Android it is not a
// tab (the bar holds five), so Wealth opens from Budget instead; this stack
// and the one under Budget show the same screens.
export default function WealthLayout() {
	const t = useTranslations("mobile.wealth");
	return <TabStack title={t("title")} />;
}
