import { useTranslations } from "use-intl";
import { TabStack } from "@/layout/TabStack";

export default function ProjectsLayout() {
	const t = useTranslations("mobile.tabs");
	return <TabStack title={t("projects")} />;
}
