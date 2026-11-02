import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityRow } from "@/features/activity/ActivityRow";
import { mergePending } from "@/features/activity/pending";
import { useHomeRowOps } from "@/features/activity/useHomeRowOps";
import { usePendingRows } from "@/features/activity/usePending";
import { ConverterSheet } from "@/features/currencies/ConverterSheet";
import { SyncIssues } from "@/features/entry/SyncIssues";
import { useHomeDates } from "@/features/home/dates";
import { Glance } from "@/features/home/Glance";
import { HomeSkeleton } from "@/features/home/HomeSkeleton";
import { NeedsYou } from "@/features/home/NeedsYou";
import { fetchHome, HOME_CACHE, RECENT_COUNT } from "@/features/home/source";
import { useUnreadNotifications } from "@/features/notifications/useUnreadCount";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useReloadOnEntryChange } from "@/features/read/useReloadOnEntryChange";
import { entryHref } from "@/layout/detailRoutes";
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
	const rowOps = useHomeRowOps();
	// Entries still waiting on this phone join Recent, as they join Activity.
	const pending = usePendingRows(
		state.status === "ready" && !state.refreshing && state.staleSince === null
			? state.data
			: null,
	);
	const recent = useMemo(
		() =>
			state.status === "ready"
				? mergePending(state.data.recent, pending).items.slice(0, RECENT_COUNT)
				: [],
		[state, pending],
	);
	const [refreshing, setRefreshing] = useState(false);
	// An entry added, undone or sent from the outbox changes what Home shows.
	useReloadOnEntryChange(reload);

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
						{recent.length === 0 ? (
							<EmptyState title={t("recent.empty")} />
						) : (
							<ListGroup>
								{recent.map((item) => (
									<ActivityRow
										item={item}
										key={item.id}
										onOpen={(row) =>
											router.push(entryHref(row.id, true, JSON.stringify(row)))
										}
										ops={rowOps}
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
						onPress: () => router.push("/home/search"),
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
						onPress: () => router.push("/home/inbox"),
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
