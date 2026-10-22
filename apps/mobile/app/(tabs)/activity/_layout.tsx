import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

export default function ActivityLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("activity")} />;
}
