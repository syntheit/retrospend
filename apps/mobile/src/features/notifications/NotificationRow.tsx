import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { Cover } from "@/features/projects/Cover";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { IconTile } from "@/ui/IconTile";
import { ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import { type Lead, sentenceOf } from "./rules";
import type { InboxNotification } from "./source";

/**
 * One notification: who or what it is from (a face, or the project's cover),
 * the sentence, and under it the time with a status word while it is unread
 * (a word and a color, never the color alone). The sentence is medium weight
 * while unread. Swiping right, or a long press, marks it read.
 */
export function NotificationRow({
	notification,
	lead,
	onOpen,
	onMarkRead,
}: {
	notification: InboxNotification;
	lead: Lead;
	onOpen: () => void;
	onMarkRead: () => void;
}) {
	const t = useTranslations("mobile.notifications");
	const format = useFormatter();
	const { size, space } = useTheme();
	const baseUrl = useServerBaseUrl();
	const faces = useFaces();
	const unread = !notification.isRead;
	const sentence = sentenceOf(notification);
	const time = format.dateTime(new Date(notification.createdAt), {
		timeStyle: "short",
	});

	const mark = {
		id: "read",
		label: t("markRead"),
		onPress: onMarkRead,
	};

	const leadMark =
		lead?.kind === "face" ? (
			<Avatar
				face={
					faces([
						{
							key: lead.person.key,
							name: lead.person.name,
							imageUrl: lead.person.imageUrl,
						},
					])[0] ?? { key: lead.person.key, name: lead.person.name }
				}
			/>
		) : lead?.kind === "cover" ? (
			<Cover
				diameter={size.avatar.default}
				id={lead.project.id}
				imageUri={absoluteImage(lead.project.imageUrl, baseUrl)}
				name={lead.project.name}
			/>
		) : (
			<IconTile name="Bell" />
		);

	const row = (
		<ListRow
			accessibilityLabel={[unread ? t("unread") : null, sentence, time]
				.filter(Boolean)
				.join(", ")}
			lead={leadMark}
			sub={
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					{unread ? (
						<StatusText label={t("unread")} size="sm" tone="attention" />
					) : null}
					<Text numberOfLines={1} tone="fg3" variant="meta">
						{time}
					</Text>
				</View>
			}
			title={
				<Text numberOfLines={3} weight={unread ? "medium" : "normal"}>
					{sentence}
				</Text>
			}
		/>
	);

	return (
		<SwipeRow
			leading={
				unread
					? { label: t("markRead"), onPress: onMarkRead, tone: "brand" }
					: undefined
			}
			menu={unread ? [mark] : []}
			menuTitle={sentence}
			onPress={onOpen}
		>
			{row}
		</SwipeRow>
	);
}
