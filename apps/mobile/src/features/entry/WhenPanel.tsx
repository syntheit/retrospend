import { dayKey } from "@retrospend/domain/time-zone";
import { Pressable, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { DateField } from "@/ui/DateField";
import { Text } from "@/ui/Text";
import { pickerDate, shiftDay } from "./dates";

/** Today, Yesterday and the six days before: eight tiles, four to a row. */
const DAYS = 8;
const COLUMNS = 4;

/** The label of a day on a tile and in the summary: Today, Yesterday, or weekday and date. */
export function useDayWords() {
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const today = dayKey(new Date());
	const yesterday = shiftDay(today, -1);
	return {
		today,
		/** "Today", "Yesterday", or "Oct 29". */
		short: (day: string) =>
			day === today
				? tc("today")
				: day === yesterday
					? tc("yesterday")
					: format.dateTime(pickerDate(day, "local"), {
							month: "short",
							day: "numeric",
						}),
		/** The top line of a tile: Today, Yesterday, or the weekday. */
		top: (day: string) =>
			day === today
				? tc("today")
				: day === yesterday
					? tc("yesterday")
					: format.dateTime(pickerDate(day, "local"), { weekday: "short" }),
		/** The line under it: the date. */
		sub: (day: string) =>
			format.dateTime(pickerDate(day, "local"), {
				month: "short",
				day: "numeric",
			}),
	};
}

/**
 * The day, in place: eight tiles for the last eight days (Today and Yesterday
 * by name, then weekday and date), and Earlier date, which opens the system
 * date control for any other day. A day picked with the control, outside the
 * eight, shows on the Earlier date row.
 */
export function WhenPanel({
	date,
	onPick,
}: {
	date: string;
	onPick: (day: string) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { color, radius, size, space } = useTheme();
	const words = useDayWords();
	const days = Array.from({ length: DAYS }, (_, i) =>
		shiftDay(words.today, -i),
	);
	const rows = Array.from({ length: DAYS / COLUMNS }, (_, r) =>
		days.slice(r * COLUMNS, (r + 1) * COLUMNS),
	);
	return (
		<View style={{ gap: space[2] }}>
			{rows.map((row) => (
				<View key={row.join()} style={{ flexDirection: "row", gap: space[2] }}>
					{row.map((day) => {
						const on = day === date;
						return (
							<Pressable
								accessibilityLabel={`${words.top(day)}, ${words.sub(day)}`}
								accessibilityRole="button"
								accessibilityState={{ selected: on }}
								key={day}
								onPress={() => onPick(day)}
								style={({ pressed }) => ({
									flex: 1,
									minHeight: size.touchMin.phone + space[1],
									alignItems: "center",
									justifyContent: "center",
									borderRadius: radius.panel,
									borderWidth: 1,
									borderColor: on ? color.brand : "transparent",
									backgroundColor: on
										? color.brandSoft
										: pressed
											? color.raised
											: color.surface,
								})}
							>
								<Text
									numberOfLines={1}
									scale="chrome"
									variant="small"
									weight="medium"
								>
									{words.top(day)}
								</Text>
								<Text
									numberOfLines={1}
									scale="chrome"
									tone="fg3"
									variant="meta"
								>
									{words.sub(day)}
								</Text>
							</Pressable>
						);
					})}
				</View>
			))}
			<View
				style={{
					paddingHorizontal: space[3],
					borderRadius: radius.panel,
					backgroundColor: color.surface,
				}}
			>
				<DateField label={t("earlierDate")} onChange={onPick} value={date} />
			</View>
		</View>
	);
}
