import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

export default function AddLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("add")} />;
}
