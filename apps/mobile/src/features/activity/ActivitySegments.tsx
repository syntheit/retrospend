import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Segmented } from "@/ui/Segmented";

export type ActivitySegment = "expenses" | "recurring";

/**
 * Expenses and Recurring, the two parts of Activity (the mockup's tabs under
 * its title). The system segmented control, in the page gutter, at the top
 * of whichever list is showing.
 */
export function ActivitySegments({
	value,
	onChange,
}: {
	value: ActivitySegment;
	onChange: (next: ActivitySegment) => void;
}) {
	const t = useTranslations("mobile.activity.segment");
	const { space } = useTheme();
	return (
		<View style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}>
			<Segmented
				accessibilityLabel={t("label")}
				onChange={onChange}
				options={[
					{ value: "expenses", label: t("expenses") },
					{ value: "recurring", label: t("recurring") },
				]}
				value={value}
			/>
		</View>
	);
}
