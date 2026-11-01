import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityRow } from "@/features/activity/ActivityRow";
import { subscribeEntryChanges } from "@/features/entry/events";
import { SyncIssues } from "@/features/entry/SyncIssues";
import { ConverterSheet } from "@/features/currencies/ConverterSheet";
import { useHomeDates } from "@/features/home/dates";
import { Glance } from "@/features/home/Glance";
import { HomeSkeleton } from "@/features/home/HomeSkeleton";
import { NeedsYou } from "@/features/home/NeedsYou";
import { fetchHome, HOME_CACHE } from "@/features/home/source";
import { useUnreadNotifications } from "@/features/notifications/useUnreadCount";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useShowConverter } from "@/lib/converter-pref";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function HomeScreen() {
	const t = useTranslations("mobile.home");
	const tc = useTranslations("mobile.common");
	const ts = useTranslations("mobile.tabs");
	const tb = useTranslations("mobile.home.topBar");
	const unread = useUnreadNotifications();
	const showConverter = useShowConverter();
	const [converter, setConverter] = useState(false);
	const { space } = useTheme();
	const dates = useHomeDates();
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchHome(api) : null), [api]);
	const { state, reload } = useCachedRead(HOME_CACHE, fetch);
	const [refreshing, setRefreshing] = useState(false);
	// An entry added, undone or sent from the outbox changes what Home shows.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await reload();
		} finally {
			setRefreshing(false);
		}
	}, [reload]);

	return (
		<>
			<Screen flush onRefresh={refresh} refreshing={refreshing}>
				{state.status === "ready" ? (
					<>
						<Text
							style={{ paddingHorizontal: space[4], paddingBottom: space[3] }}
							tone="fg2"
						>
							{dates.weekday(state.data.glance.today)}
						</Text>
						<StaleNote since={state.staleSince} />
						<Glance
							approx={state.data.approx}
							glance={state.data.glance}
							owers={state.data.owers}
						/>
						<SyncIssues padded />
						<NeedsYou list={state.data.needs} />
						<SectionHeader
							actionLabel={t("recent.seeAll")}
							onAction={() => router.navigate("/activity")}
							title={t("recent.title")}
						/>
						{state.data.recent.items.length === 0 ? (
							<EmptyState title={t("recent.empty")} />
						) : (
							<ListGroup>
								{state.data.recent.items.map((item) => (
									<ActivityRow
										item={item}
										key={item.id}
										onPress={() =>
											router.navigate({
												pathname: "/activity/[id]",
												params: { id: item.id, row: JSON.stringify(item) },
											})
										}
									/>
								))}
							</ListGroup>
						)}
					</>
				) : state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={() => void refresh()}
						title={t("error")}
					/>
				) : (
					<HomeSkeleton />
				)}
			</Screen>
			{/* After the scroll view: see ListDetail. */}
			<AccountTopBar
				actions={[
					{
						id: "search",
						icon: "Search",
						label: ts("search"),
						onPress: () => router.push("/settings/search"),
					},
					...(showConverter
						? [
								{
									id: "converter",
									icon: "DollarSign" as const,
									label: tb("converter"),
									onPress: () => setConverter(true),
								},
							]
						: []),
					{
						id: "notifications",
						icon: "Bell",
						label:
							unread > 0
								? tb("notificationsUnread", { count: unread })
								: tb("notifications"),
						badge: unread,
						onPress: () => router.push("/settings/inbox"),
					},
				]}
				title={t("title")}
			/>
			{showConverter ? (
				<ConverterSheet
					onClose={() => setConverter(false)}
					visible={converter}
				/>
			) : null}
		</>
	);
}
