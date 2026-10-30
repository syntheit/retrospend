import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Menu } from "@/ui/Menu";
import type { MenuItem } from "@/ui/types";
import type { RecurringFilter } from "./filter";

/**
 * The Recurring chips: an Auto-pay menu chip (on, off or any, one choice)
 * and the Foreign currency toggle.
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
	const autoPayItems: MenuItem[] = [
		{
			id: "any",
			label: t("autoPayAny"),
			onPress: () => onChange({ ...filter, autoPay: null }),
		},
		{
			id: "on",
			label: t("autoPayOn"),
			onPress: () => onChange({ ...filter, autoPay: "on" }),
		},
		{
			id: "off",
			label: t("autoPayOff"),
			onPress: () => onChange({ ...filter, autoPay: "off" }),
		},
	];
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
			<Menu
				active={filter.autoPay !== null}
				chip
				items={autoPayItems}
				label={
					filter.autoPay === "on"
						? t("autoPayOn")
						: filter.autoPay === "off"
							? t("autoPayOff")
							: t("autoPayFilter")
				}
			/>
			<Chip
				label={t("foreign")}
				onPress={() => onChange({ ...filter, foreign: !filter.foreign })}
				selected={filter.foreign}
			/>
		</ScrollView>
	);
}
