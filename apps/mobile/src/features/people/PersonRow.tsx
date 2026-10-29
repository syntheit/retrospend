import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { NetAmount, useNetText } from "./NetAmount";
import { agoOf, daysSince } from "./relative";
import type { PersonSummary } from "./source";

/** A past day as a short phrase: "4d ago", or its date after a year. */
function useAgo() {
	const t = useTranslations("mobile.people.ago");
	const format = useFormatter();
	return (day: string): string => {
		const ago = agoOf(daysSince(day, new Date()));
		if (ago === null) {
			const [y, m, d] = day.split("-").map(Number) as [number, number, number];
			return format.dateTime(new Date(y, m - 1, d, 12), {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		}
		return ago.unit === "today"
			? t("today")
			: t(ago.unit, { count: ago.count });
	};
}

/**
 * One person in the People list, on three lines: the name, the last shared
 * expense and how long ago, and a status (a dot and a word). The balance is
 * on the right, with how many currencies it spans.
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
	const tp = useTranslations("mobile.person");
	const netText = useNetText();
	const ago = useAgo();
	const faces = useFaces();
	const { space } = useTheme();
	const { person } = summary;
	const [face] = faces([person]);

	const statusWord =
		summary.needsYou > 0
			? t("needsYou", { count: summary.needsYou })
			: summary.pending
				? summary.pending.direction === "in"
					? t("pendingIn")
					: t("pendingOut")
				: !person.onRetrospend
					? t("notOn")
					: null;
	const status =
		statusWord === null ? null : summary.needsYou > 0 ? (
			<StatusText label={statusWord} size="sm" tone="attention" />
		) : summary.pending ? (
			<StatusText label={statusWord} size="sm" tone="info" />
		) : (
			<StatusText kind="notOnRetrospend" size="sm" />
		);
	const last = summary.lastShared;
	const when = last ? ago(last.date) : null;

	return (
		<ListRow
			accessibilityLabel={[
				person.name,
				statusWord,
				last ? `${last.title}, ${when}` : null,
				summary.group === "settled"
					? null
					: `${summary.group === "owed" ? tp("owesYou") : tp("youOweThem")} ${netText(summary.net, summary.parts, home)}`,
			]
				.filter(Boolean)
				.join(", ")}
			end={
				summary.group === "settled" ? null : (
					<NetAmount
						home={home}
						net={summary.net}
						parts={summary.parts}
						tone={summary.group === "owed" ? "positive" : "default"}
					/>
				)
			}
			lead={face ? <Avatar face={face} size="row" /> : null}
			onPress={onPress}
			selected={selected}
			sub={
				<View style={{ gap: space[1] }}>
					{last ? (
						<View style={{ flexDirection: "row", gap: space[1] }}>
							<Text
								numberOfLines={1}
								style={{ flexShrink: 1 }}
								tone="fg2"
								variant="meta"
							>
								{last.title}
							</Text>
							<Text tone="fg3" variant="meta">
								{`· ${when}`}
							</Text>
						</View>
					) : null}
					{status}
				</View>
			}
			title={person.name}
		/>
	);
}
