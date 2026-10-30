import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import type { ActivityFilter } from "./filter";
import type { ActivityPage } from "./source";

/**
 * The line under the title: how many expenses the filter matches and over
 * what period ("250 expenses, all time"). The count is the server's, from
 * the first page; with none yet the line is not drawn.
 */
export function ActivitySummary({
	page,
	period,
}: {
	page: ActivityPage;
	period: ActivityFilter["period"];
}) {
	const t = useTranslations("mobile.activity.summary");
	const { space } = useTheme();
	if (page.count === null) return null;
	return (
		<View style={{ paddingHorizontal: space[4], paddingVertical: space[1] }}>
			<Text tone="fg2" variant="small">
				{t(period, { count: page.count })}
			</Text>
		</View>
	);
}
