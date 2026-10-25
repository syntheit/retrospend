import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { ListRow } from "@/features/read/parts";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { NetAmount } from "./NetAmount";
import type { PersonSummary } from "./source";

/**
 * One person in the People list: face, name, what is going on (a status
 * word first, then the last shared entry) and the balance on the right.
 */
export function PersonRow({
	summary,
	home,
	onPress,
	selected,
}: {
	summary: PersonSummary;
	home: string;
	onPress: () => void;
	selected?: boolean;
}) {
	const t = useTranslations("mobile.people");
	const format = useFormatter();
	const faces = useFaces();
	const { color, type } = useTheme();
	const { person } = summary;
	const [face] = faces([person]);

	const status =
		summary.needsYou > 0
			? t("needsYou", { count: summary.needsYou })
			: summary.pending
				? summary.pending.direction === "in"
					? t("pendingIn")
					: t("pendingOut")
				: !person.onRetrospend
					? t("notOn")
					: null;
	const last = summary.lastShared
		? `${summary.lastShared.title}, ${format.dateTime(
				new Date(`${summary.lastShared.date}T12:00:00`),
				{ month: "short", day: "numeric" },
			)}`
		: null;

	return (
		<ListRow
			accessibilityLabel={[person.name, status, last]
				.filter(Boolean)
				.join(", ")}
			onPress={onPress}
			selected={selected}
		>
			{face ? <Avatar face={face} size="md" /> : null}
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{person.name}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{status ? (
						<Text
							style={{
								color: summary.needsYou > 0 ? color.attentionText : color.fg2,
								fontWeight: "500",
							}}
						>
							{status}
						</Text>
					) : null}
					{status && last ? " · " : ""}
					{last ?? ""}
				</Text>
			</View>
			{summary.group === "settled" ? null : (
				<NetAmount
					home={home}
					net={summary.net}
					parts={summary.parts}
					tone={summary.group === "owed" ? "positive" : "default"}
				/>
			)}
		</ListRow>
	);
}
