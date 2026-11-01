import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { markPaneSwitch, PaneVeil } from "@/ui/PaneVeil";
import { UnderlineTabs } from "@/ui/UnderlineTabs";

export type ActivitySegment = "expenses" | "recurring";

/**
 * Expenses and Recurring, the parts of Activity: sibling panes, so underline
 * tabs as on People and Projects (the mockup's tabs under its title), at the
 * top of whichever list is showing. Both lists start with it, at the same
 * place, so a switch moves nothing above the content (PaneVeil fades the new
 * pane in under it).
 */
export function ActivitySegments({
	value,
	onChange,
}: {
	value: ActivitySegment;
	onChange: (next: ActivitySegment) => void;
}) {
	const t = useTranslations("mobile.activity.segment");
	const { color, space } = useTheme();
	return (
		<View style={{ zIndex: 1 }}>
			<View style={{ paddingBottom: space[2], backgroundColor: color.bg }}>
				<UnderlineTabs<ActivitySegment>
					accessibilityLabel={t("label")}
					onChange={(next) => {
						markPaneSwitch();
						onChange(next);
					}}
					tabs={[
						{ value: "expenses", label: t("expenses") },
						{ value: "recurring", label: t("recurring") },
					]}
					value={value}
				/>
			</View>
			<PaneVeil />
		</View>
	);
}
