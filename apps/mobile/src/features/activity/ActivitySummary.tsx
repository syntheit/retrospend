import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import type { ActivityPage } from "./source";

/**
 * The line under the title: how many expenses the filter matches ("250
 * expenses"). The count is the server's, from the first page; with none yet
 * the line is not drawn.
 */
export function ActivitySummary({ page }: { page: ActivityPage }) {
	const t = useTranslations("mobile.activity");
	const { space } = useTheme();
	if (page.count === null) return null;
	return (
		<View style={{ paddingHorizontal: space[4], paddingVertical: space[1] }}>
			<Text tone="fg2" variant="small">
				{t("summary", { count: page.count })}
			</Text>
		</View>
	);
}
