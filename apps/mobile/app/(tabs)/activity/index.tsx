import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { SectionList, Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityFilters } from "@/features/activity/ActivityFilters";
import { ActivityRow } from "@/features/activity/ActivityRow";
import { groupByDay } from "@/features/activity/days";
import { EntryView } from "@/features/activity/EntryView";
import { DEFAULT_FILTER, isDefaultFilter } from "@/features/activity/filter";
import type { ActivityItem, ActivityPage } from "@/features/activity/source";
import { useActivity } from "@/features/activity/useActivity";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { StaleNote } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListDetail } from "@/ui/ListDetail";
import { Screen } from "@/ui/Screen";

const SEARCH_DELAY_MS = 300;

/** "Wed, Oct 21": a day the server named, shown in the phone's language. */
function useDayLabel() {
	const t = useTranslations("mobile.activity");
	const format = useFormatter();
	return (day: string, relative: "today" | "yesterday" | null) => {
		if (relative) return t(relative);
		const [y, m, d] = day.split("-").map(Number) as [number, number, number];
		return format.dateTime(new Date(y, m - 1, d, 12), {
			weekday: "short",
			month: "short",
			day: "numeric",
		});
	};
}

function Summary({ page }: { page: ActivityPage }) {
	const t = useTranslations("mobile.activity");
	const format = useMoneyText();
	const { color, space, type } = useTheme();
	if (page.count === null) return null;
	const spent = page.total ? format(page.total.value) : null;
	return (
		<Text
			style={{
				color: color.fg2,
				fontSize: type.small.size,
				paddingHorizontal: space[4],
				paddingVertical: space[2],
			}}
		>
			{spent
				? t("summarySpent", { count: page.count, amount: spent })
				: t("summary", { count: page.count })}
		</Text>
	);
}

export default function ActivityScreen() {
	const t = useTranslations("mobile.activity");
	const dayLabel = useDayLabel();
	const { color, space, type } = useTheme();
	const { listDetail } = useLayoutClass();
	const searchRef = useSearchShortcut();
	const [filter, setFilter] = useState(DEFAULT_FILTER);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<ActivityItem | null>(null);
	const { state, reload, loadMore, loadingMore } = useActivity(filter);

	// The search bar sends text as it is typed; the list asks once it pauses.
	useEffect(() => {
		const timer = setTimeout(
			() => setFilter((f) => (f.q === search ? f : { ...f, q: search })),
			SEARCH_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [search]);

	const page = state.status === "ready" ? state.data : null;
	const sections = useMemo(
		() =>
			page
				? groupByDay(page.items, page.dayTotals, page.today).map((s) => ({
						...s,
						data: s.items,
					}))
				: [],
		[page],
	);

	function open(item: ActivityItem) {
		if (listDetail) {
			setSelected(item);
			return;
		}
		router.push({
			pathname: "/activity/[id]",
			params: { id: item.id, row: JSON.stringify(item) },
		});
	}

	const empty =
		state.status === "loading" ? (
			<EmptyState title={t("loading")} />
		) : state.status === "error" ? (
			<EmptyState detail={t("errorDetail")} title={t("error")} />
		) : page?.elsewhere ? (
			<EmptyState title={t("emptyElsewhere")} />
		) : (
			<EmptyState
				title={isDefaultFilter(filter) ? t("empty") : t("emptyFiltered")}
			/>
		);

	const list = (
		<SectionList
			contentInsetAdjustmentBehavior="automatic"
			keyboardDismissMode="on-drag"
			keyExtractor={(item) => item.id}
			ListEmptyComponent={empty}
			ListFooterComponent={
				loadingMore ? (
					<Text
						style={{
							color: color.fg2,
							fontSize: type.small.size,
							padding: space[4],
							textAlign: "center",
						}}
					>
						{t("loading")}
					</Text>
				) : undefined
			}
			ListHeaderComponent={
				<View>
					<StaleNote
						since={state.status === "ready" ? state.staleSince : null}
					/>
					<ActivityFilters filter={filter} onChange={setFilter} />
					{page ? <Summary page={page} /> : null}
				</View>
			}
			onEndReached={loadMore}
			onEndReachedThreshold={0.6}
			onRefresh={reload}
			refreshing={false}
			renderItem={({ item }) => (
				<ActivityRow
					item={item}
					onPress={() => open(item)}
					selected={listDetail && selected?.id === item.id}
				/>
			)}
			renderSectionHeader={({ section }) => (
				<View
					style={{
						flexDirection: "row",
						alignItems: "baseline",
						justifyContent: "space-between",
						paddingHorizontal: space[4],
						paddingTop: space[4],
						paddingBottom: space[1],
						backgroundColor: color.bg,
					}}
				>
					<Text
						accessibilityRole="header"
						style={{
							color: color.fg2,
							fontSize: type.small.size,
							fontWeight: "600",
						}}
					>
						{dayLabel(section.day, section.relative)}
					</Text>
					{section.total ? (
						<MoneyAmount tone="muted" value={section.total} />
					) : null}
				</View>
			)}
			sections={sections}
			stickySectionHeadersEnabled={false}
			style={{ backgroundColor: color.bg }}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{listDetail ? null : (
				<Stack.Screen
					options={{
						headerSearchBarOptions: {
							ref: searchRef,
							placeholder: t("search"),
							onChangeText: (event) => setSearch(event.nativeEvent.text),
						},
					}}
				/>
			)}
			<ListDetail
				bar={<AccountTopBar title={t("title")} />}
				detail={
					<Screen>
						{selected ? (
							<EntryView item={selected} />
						) : (
							<EmptyState title={t("pick")} />
						)}
					</Screen>
				}
				list={list}
				search={{
					value: search,
					onChange: setSearch,
					placeholder: t("search"),
					ref: searchRef,
				}}
			/>
		</View>
	);
}
