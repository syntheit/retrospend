import { dayKey } from "@retrospend/domain/time-zone";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { shiftDay } from "@/features/entry/dates";
import { useTheme } from "@/theme";
import { Chip } from "./Chip";

/**
 * The web date picker's shortcuts, under a DateField's row: Today and
 * Yesterday as choice chips, on while the field holds that day. The calendar
 * stays in the field itself.
 */
export function DateQuickDays({
	value,
	onChange,
	today = dayKey(new Date()),
}: {
	value: string;
	onChange: (day: string) => void;
	/** Today in another zone than the phone's, when the server's counts. */
	today?: string;
}) {
	const t = useTranslations("mobile.common");
	const { space } = useTheme();
	const yesterday = shiftDay(today, -1);
	return (
		<View style={{ flexDirection: "row", gap: space[2] }}>
			<Chip
				label={t("today")}
				onPress={() => onChange(today)}
				selected={value === today}
			/>
			<Chip
				label={t("yesterday")}
				onPress={() => onChange(yesterday)}
				selected={value === yesterday}
			/>
		</View>
	);
}
