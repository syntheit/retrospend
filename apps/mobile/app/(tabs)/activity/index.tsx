import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Platform, SectionList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityFilters } from "@/features/activity/ActivityFilters";
import { ActivityRow } from "@/features/activity/ActivityRow";
import { ActivitySegments } from "@/features/activity/ActivitySegments";
import { ActivitySummary } from "@/features/activity/ActivitySummary";
import { BulkControls } from "@/features/activity/BulkControls";
import { canSelect } from "@/features/activity/bulk";
import { DayHeader, useDayLabel } from "@/features/activity/DayHeader";
import { groupByDay } from "@/features/activity/days";
import { EntryDetail } from "@/features/activity/EntryView";
import { DEFAULT_FILTER, isDefaultFilter } from "@/features/activity/filter";
import { ImportNotice } from "@/features/activity/ImportNotice";
import { useLinkedEntry } from "@/features/activity/linkedEntry";
import { rowActions } from "@/features/activity/rowActions";
import type { ActivityItem } from "@/features/activity/source";
import { useActivity } from "@/features/activity/useActivity";
import { useBulkActions } from "@/features/activity/useBulkActions";
import { useDebouncedSearch } from "@/features/activity/useDebouncedSearch";
import { useImportReview } from "@/features/activity/useImportReview";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { RecurringView } from "@/features/recurring/RecurringView";
import { RECURRING_APART } from "@/layout/destinations";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, StaleNote } from "@/ui/List";
import { EmptyDetail, ListDetail } from "@/ui/ListDetail";
import { Screen, useAddInset } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";

export default function ActivityScreen() {
	const t = useTranslations("mobile.activity");
	const te = useTranslations("mobile.entry");
	const tc = useTranslations("mobile.common");
	const tr = useTranslations("mobile.recurring");
	const dayLabel = useDayLabel();
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const searchRef = useSearchShortcut();
	const insets = useSafeAreaInsets();
	const addInset = useAddInset();
	const add = useOptionalAddEntry();
	const params = useLocalSearchParams<{ segment?: string }>();
	// On the iPad sidebar Recurring is a destination of its own.
	const [segment, setSegment] = useState<"expenses" | "recurring">(
		params.segment === "recurring" && !RECURRING_APART
			? "recurring"
			: "expenses",
	);
	// A link to the Recurring segment (Settings, a notification) opens it even
	// when Activity is already mounted on Expenses.
	useEffect(() => {
		if (params.segment === "recurring" && !RECURRING_APART) {
			setSegment("recurring");
		}
	}, [params.segment]);
	const [addingRecurring, setAddingRecurring] = useState(false);
	const [filter, setFilter] = useState(DEFAULT_FILTER);
	const [search, setSearch] = useDebouncedSearch((q) =>
		setFilter((f) => (f.q === q ? f : { ...f, q })),
	);
	const [selected, setSelected] = useState<ActivityItem | null>(null);
	// An entry opened by a link (a Home row, a notification) fills the detail.
	const { link: linked, release: releaseLink } = useLinkedEntry();
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new link replaces the picked row
	useEffect(() => setSelected(null), [linked]);
	// Ids of the rows picked for a bulk action; null when not selecting.
	const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
	const { state, reload, loadMore, loadingMore } = useActivity(filter);
	const bulk = useBulkActions(() => setPicked(null));
	const importing = useImportReview();

	const page = state.status === "ready" ? state.data : null;
	const sections = useMemo(
		() =>
			page
				? groupByDay(page.items, page.dayTotals, page.today).map((s) => ({
						...s,
						// One item per day: the day's rows are one inset group.
						data: [s.items],
					}))
				: [],
		[page],
	);

	function toggle(item: ActivityItem) {
		if (!canSelect(item)) return;
		setPicked((prev) => {
			const next = new Set(prev ?? []);
			if (!next.delete(item.id)) next.add(item.id);
			return next;
		});
	}

	function open(item: ActivityItem) {
		if (picked) {
			toggle(item);
			return;
		}
		if (listDetail) {
			setSelected(item);
			// The picked row now owns the pane; the same link may ask again.
			releaseLink();
			return;
		}
		router.push({
			pathname: "/activity/[id]",
			params: { id: item.id, row: JSON.stringify(item) },
		});
	}

	const words = {
		select: t("bulk.select"),
		edit: te("edit"),
		categorize: t("bulk.categorize"),
		delete: t("bulk.delete"),
	};
	const actionsOf = (item: ActivityItem) =>
		rowActions(
			item,
			words,
			{
				select: () => setPicked(new Set([item.id])),
				edit: () =>
					add?.edit(
						item.entityId,
						item.source === "shared" ? "shared" : undefined,
					),
				categorize: () => bulk.categorize([item.entityId]),
				remove: () => bulk.remove([item.entityId]),
			},
			add !== null,
		);

	const segments = RECURRING_APART ? null : (
		<ActivitySegments onChange={setSegment} value={segment} />
	);

	const empty =
		state.status === "loading" ? (
			<SkeletonRows count={6} />
		) : state.status === "error" ? (
			<EmptyState
				actionLabel={tc("retry")}
				detail={t("errorDetail")}
				onAction={reload}
				title={t("error")}
			/>
		) : page?.elsewhere ? (
			<EmptyState title={t("emptyElsewhere")} />
		) : (
			<EmptyState
				title={isDefaultFilter(filter) ? t("empty") : t("emptyFiltered")}
			/>
		);

	const rows = (
		<SectionList
			contentInsetAdjustmentBehavior="automatic"
			extraData={picked}
			keyboardDismissMode="on-drag"
			keyExtractor={(items) => items[0]?.id ?? "empty"}
			ListEmptyComponent={empty}
			ListFooterComponent={
				loadingMore ? (
					<Text
						style={{ padding: space[4], textAlign: "center" }}
						tone="fg2"
						variant="small"
					>
						{t("loading")}
					</Text>
				) : (
					<View style={{ height: addInset }} />
				)
			}
			ListHeaderComponent={
				<View>
					{page && !picked ? (
						<ActivitySummary page={page} period={filter.period} />
					) : null}
					{segments}
					<StaleNote
						since={state.status === "ready" ? state.staleSince : null}
					/>
					<ActivityFilters filter={filter} onChange={setFilter} />
					{importing !== null && !picked ? (
						<ImportNotice count={importing} />
					) : null}
				</View>
			}
			onEndReached={loadMore}
			onEndReachedThreshold={0.6}
			onRefresh={reload}
			refreshing={false}
			renderItem={({ item: items }) => (
				<ListGroup>
					{items.map((item) => (
						<ActivityRow
							actions={picked ? undefined : actionsOf(item)}
							item={item}
							key={item.id}
							onPress={() => open(item)}
							pick={
								picked
									? { checked: picked.has(item.id), enabled: canSelect(item) }
									: undefined
							}
							selected={listDetail && !picked && selected?.id === item.id}
						/>
					))}
				</ListGroup>
			)}
			renderSectionHeader={({ section }) => (
				<DayHeader
					label={dayLabel(section.day, section.relative)}
					total={section.total}
				/>
			)}
			sections={sections}
			stickySectionHeadersEnabled={false}
			style={{ backgroundColor: color.bg }}
		/>
	);
	// The phone's large-title bar is transparent over the list, so the bulk bar
	// takes its place at the top instead of sitting in the list's flow.
	const overBar = Platform.OS === "ios" && !listDetail;
	const list = picked ? (
		<View style={{ flex: 1 }}>
			<View
				style={
					overBar
						? {
								position: "absolute",
								top: insets.top,
								left: 0,
								// Clears the account button the native bar keeps on top.
								right: space[12] + space[4],
								zIndex: 1,
							}
						: undefined
				}
			>
				<BulkControls
					actions={bulk}
					items={page?.items ?? []}
					onDone={() => setPicked(null)}
					picked={picked}
				/>
			</View>
			{rows}
		</View>
	) : (
		rows
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{listDetail ? null : (
				<Stack.Screen
					options={{
						headerSearchBarOptions: {
							ref: searchRef,
							placeholder: segment === "recurring" ? tr("search") : t("search"),
							onChangeText: (event) => setSearch(event.nativeEvent.text),
						},
					}}
				/>
			)}
			<ListDetail
				bar={
					<AccountTopBar
						actions={
							segment === "recurring"
								? [
										{
											id: "add-recurring",
											icon: "Plus",
											label: tr("add.title"),
											onPress: () => setAddingRecurring(true),
										},
									]
								: undefined
						}
						overflow={
							segment === "expenses" && !picked
								? [
										{
											id: "select",
											label: t("bulk.select"),
											onPress: () => setPicked(new Set()),
										},
									]
								: undefined
						}
						overflowLabel={t("overflow")}
						title={segment === "recurring" ? tr("title") : t("title")}
					/>
				}
				detail={
					segment === "expenses" && !selected && !linked ? (
						<EmptyDetail title={t("pick")} />
					) : (
						<Screen>
							{segment === "recurring" ? null : selected ? (
								<EntryDetail id={selected.id} placeholder={selected} />
							) : linked ? (
								<EntryDetail id={linked.id} placeholder={linked.placeholder} />
							) : null}
						</Screen>
					)
				}
				list={
					segment === "recurring" ? (
						<RecurringView
							adding={addingRecurring}
							embedded
							header={segments}
							onAdd={() => setAddingRecurring(true)}
							onAddClose={() => setAddingRecurring(false)}
							query={search}
						/>
					) : (
						list
					)
				}
				search={{
					value: search,
					onChange: setSearch,
					placeholder: segment === "recurring" ? tr("search") : t("search"),
					ref: searchRef,
				}}
			/>
			{bulk.sheets}
		</View>
	);
}
