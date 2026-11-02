import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { DayHeader, useDayLabel } from "@/features/activity/DayHeader";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { LinkButton, ListGroup, StaleNote } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { SkeletonRows } from "@/ui/Skeleton";
import { TopBarAction } from "@/ui/TopBarAction";
import { NotificationRow } from "./NotificationRow";
import { openTarget } from "./openTarget";
import {
	filterNotifications,
	groupByDay,
	leadOf,
	NOTIFICATION_FILTERS,
	type NotificationFilter,
	targetOf,
} from "./rules";
import type { InboxNotification } from "./source";
import { useInbox } from "./useInbox";

/**
 * The notifications inbox (the web's bell, as a pushed screen): newest
 * first, grouped by day, unread marked with a word. A tap opens what the
 * note is about and marks it read; Mark all read and the notification
 * settings sit in the header.
 */
export function NotificationsScreen() {
	const t = useTranslations("mobile.notifications");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const dayLabel = useDayLabel();
	const inbox = useInbox();
	const { data, state } = inbox;
	const [filter, setFilter] = useState<NotificationFilter>("all");

	const open = (n: InboxNotification) => {
		if (!n.isRead) void inbox.markRead([n.id]);
		const target = targetOf(n);
		if (target) openTarget(target, "push", true);
	};

	const canMarkAll =
		data !== null &&
		data.items.length > 0 &&
		(inbox.unread > 0 || data.nextCursor !== null);

	const header = (
		<Stack.Screen
			options={{
				title: t("title"),
				headerLargeTitle: false,
				headerRight: () => (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						{canMarkAll ? (
							<TopBarAction
								icon="Check"
								id="markAll"
								label={t("markAllRead")}
								onPress={() => void inbox.markAllRead()}
							/>
						) : null}
						<TopBarAction
							icon="Settings"
							id="settings"
							label={t("settings")}
							onPress={() => router.push("/settings/notifications")}
						/>
					</View>
				),
			}}
		/>
	);

	if (!data) {
		return (
			<>
				{header}
				<Screen>
					{state.status === "error" ? (
						<EmptyState
							actionLabel={tc("retry")}
							detail={t("errorDetail")}
							onAction={() => void inbox.reload()}
							title={t("error")}
						/>
					) : (
						<SkeletonRows />
					)}
				</Screen>
			</>
		);
	}

	const days = groupByDay(filterNotifications(data.items, filter), new Date());
	return (
		<>
			{header}
			<Screen
				flush
				onRefresh={() => void inbox.refresh()}
				refreshing={inbox.refreshing}
			>
				{state.status === "ready" ? (
					<StaleNote since={state.staleSince} />
				) : null}
				{data.items.length > 0 ? (
					<View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
						<Segmented<NotificationFilter>
							accessibilityLabel={t("filterLabel")}
							onChange={setFilter}
							options={NOTIFICATION_FILTERS.map((value) => ({
								value,
								label: t(`filter.${value}`),
							}))}
							stretch
							value={filter}
						/>
					</View>
				) : null}
				{days.length === 0 ? (
					<EmptyState
						detail={data.items.length === 0 ? t("emptyDetail") : undefined}
						title={data.items.length === 0 ? t("empty") : t("noMatches")}
					/>
				) : (
					days.map((day) => (
						<View key={day.day}>
							<DayHeader label={dayLabel(day.day, day.relative)} total={null} />
							<ListGroup>
								{day.items.map((n) => (
									<NotificationRow
										key={n.id}
										lead={leadOf(n, data.people, data.projects)}
										notification={n}
										onMarkRead={() => void inbox.markRead([n.id])}
										onOpen={() => open(n)}
									/>
								))}
							</ListGroup>
						</View>
					))
				)}
				{data.nextCursor ? (
					<LinkButton
						label={inbox.loadingMore ? tc("loading") : t("showMore")}
						onPress={() => void inbox.showMore()}
					/>
				) : null}
				<View style={{ height: space[4] }} />
			</Screen>
		</>
	);
}
