import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Text } from "@/ui/Text";
import { PlanBlock } from "./PlanBlock";
import type { PlanView } from "./preview";

/**
 * Income's Plan panel: Use my plan or Not planned yet, and under it what that
 * does. The lines are the dry run's (the same one Add sends); Not planned yet
 * says where the money waits. The panel only exists when there is an envelope
 * budget to fill.
 */
export function PlanPanel({
	usePlan,
	onChange,
	plan,
}: {
	usePlan: boolean;
	onChange: (usePlan: boolean) => void;
	/** What Use my plan would assign, from the dry run; null before it answers. */
	plan: PlanView | null;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	return (
		<View style={{ gap: space[3] }}>
			<View
				accessibilityLabel={t("afterSaving")}
				accessibilityRole="radiogroup"
				style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
			>
				<Chip
					label={t("usePlan")}
					onPress={() => onChange(true)}
					selected={usePlan}
				/>
				<Chip
					label={t("notPlannedYet")}
					onPress={() => onChange(false)}
					selected={!usePlan}
				/>
			</View>
			{usePlan ? (
				plan ? (
					<PlanBlock plan={plan} />
				) : null
			) : (
				<Text tone="fg2">{t("plan.waits")}</Text>
			)}
		</View>
	);
}
