import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import type { RecurringFilter } from "./filter";

/**
 * The Recurring chips: Auto-pay on, Auto-pay off and Foreign currency. Each
 * toggles; the two auto-pay chips are one choice, so picking one clears the
 * other.
 */
export function RecurringFilters({
	filter,
	onChange,
}: {
	filter: RecurringFilter;
	onChange: (next: RecurringFilter) => void;
}) {
	const t = useTranslations("mobile.recurring");
	const { space } = useTheme();
	return (
		<ScrollView
			contentContainerStyle={{
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
			horizontal
			keyboardShouldPersistTaps="handled"
			showsHorizontalScrollIndicator={false}
		>
			<Chip
				label={t("autoPayOn")}
				onPress={() =>
					onChange({
						...filter,
						autoPay: filter.autoPay === "on" ? null : "on",
					})
				}
				selected={filter.autoPay === "on"}
			/>
			<Chip
				label={t("autoPayOff")}
				onPress={() =>
					onChange({
						...filter,
						autoPay: filter.autoPay === "off" ? null : "off",
					})
				}
				selected={filter.autoPay === "off"}
			/>
			<Chip
				label={t("foreign")}
				onPress={() => onChange({ ...filter, foreign: !filter.foreign })}
				selected={filter.foreign}
			/>
		</ScrollView>
	);
}
