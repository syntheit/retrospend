import { dayKey } from "@retrospend/domain/time-zone";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import { TextField } from "@/ui/TextField";
import { pickerDate, shiftDay } from "./dates";

/**
 * One surface card: the title and the day on one line (a bare field with a
 * date capsule at its end), and the card's `children` under it (the category
 * chips). The capsule reads Today, Yesterday or the picked day, and its menu
 * offers the two usual days and Pick a date, which opens More where the
 * calendar is.
 */
export function TitleCard({
	title,
	date,
	onTitleChange,
	onDateChange,
	onPickDate,
	onTypingChange,
	children,
}: {
	title: string;
	/** The day, "yyyy-MM-dd". */
	date: string;
	onTitleChange: (title: string) => void;
	onDateChange: (day: string) => void;
	/** Opens the step that has the calendar. */
	onPickDate: () => void;
	onTypingChange: (typing: boolean) => void;
	children?: ReactNode;
}) {
	const t = useTranslations("mobile.composer");
	const format = useFormatter();
	const { color, radius, space } = useTheme();
	const today = dayKey(new Date());
	const yesterday = shiftDay(today, -1);
	const shown =
		date === today
			? t("today")
			: date === yesterday
				? t("yesterday")
				: format.dateTime(pickerDate(date, "local"), {
						month: "short",
						day: "numeric",
					});
	return (
		<View
			style={{
				backgroundColor: color.surface,
				borderRadius: radius.panel,
				borderWidth: 1,
				borderColor: color.lineStrong,
				padding: space[3],
				gap: space[2],
			}}
		>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				<View style={{ flex: 1 }}>
					<TextField
						autoCapitalize="sentences"
						bare
						hideLabel
						label={t("titleField")}
						onChangeText={onTitleChange}
						onTypingChange={onTypingChange}
						placeholder={t("titlePlaceholder")}
						value={title}
					/>
				</View>
				<Menu
					accessibilityLabel={t("dateMenu", { date: shown })}
					active={false}
					chip
					items={[
						{
							id: "today",
							label: t("today"),
							onPress: () => onDateChange(today),
						},
						{
							id: "yesterday",
							label: t("yesterday"),
							onPress: () => onDateChange(yesterday),
						},
						{ id: "pick", label: t("pickDate"), onPress: onPickDate },
					]}
					label={shown}
				/>
			</View>
			{children}
		</View>
	);
}
