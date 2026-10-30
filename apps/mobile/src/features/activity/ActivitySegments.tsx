import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { openWebPage } from "@/features/settings/webPages";
import { useTheme } from "@/theme";
import { Segmented } from "@/ui/Segmented";

export type ActivitySegment = "expenses" | "recurring";

/**
 * Expenses, Recurring and Import, the parts of Activity (the mockup's tabs
 * under its title). The system segmented control, in the page gutter, at the
 * top of whichever list is showing. Import is a page on the web for now: its
 * part opens it and leaves the choice where it was.
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
	const baseUrl = useServerBaseUrl();
	return (
		<View style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}>
			<Segmented<ActivitySegment | "import">
				accessibilityLabel={t("label")}
				onChange={(next) => {
					if (next === "import") {
						if (baseUrl) void openWebPage(baseUrl, "/import");
						return;
					}
					onChange(next);
				}}
				options={[
					{ value: "expenses", label: t("expenses") },
					{ value: "recurring", label: t("recurring") },
					{ value: "import", label: t("import") },
				]}
				stretch
				value={value}
			/>
		</View>
	);
}
