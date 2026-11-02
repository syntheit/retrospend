import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ActivityFilters } from "@/features/activity/ActivityFilters";
import { ActivityRow, type RowOps } from "@/features/activity/ActivityRow";
import { ActivitySegments } from "@/features/activity/ActivitySegments";
import { ActivitySummary } from "@/features/activity/ActivitySummary";
import { BulkControls } from "@/features/activity/BulkControls";
import { canSelect, entityIdsOf } from "@/features/activity/bulk";
import { DayHeader, useDayLabel } from "@/features/activity/DayHeader";
import { groupByDay } from "@/features/activity/days";
import { EntryDetail } from "@/features/activity/EntryView";
import { stashRow } from "@/features/activity/entryRow";
import { DEFAULT_FILTER, isDefaultFilter } from "@/features/activity/filter";
import { useLinkedEntry } from "@/features/activity/linkedEntry";
import type { ActivityItem } from "@/features/activity/source";
import { useActivity } from "@/features/activity/useActivity";
import { useBulkActions } from "@/features/activity/useBulkActions";
import { useDebouncedSearch } from "@/features/activity/useDebouncedSearch";
import {
	useHideAddButton,
	useOptionalAddEntry,
} from "@/features/entry/addEntryContext";
import { SyncIssues } from "@/features/entry/SyncIssues";
import { useDeleteEntry } from "@/features/entry/useDeleteEntry";
import { useDeletePending } from "@/features/entry/useDeletePending";
import { RecurringView } from "@/features/recurring/RecurringView";
import { RECURRING_APART } from "@/layout/destinations";
import { useHeaderSearch } from "@/layout/headerSearch";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import {
	BarSectionList,
	useBarMetrics,
	useCollapsingBar,
} from "@/ui/barScroll";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, StaleNote } from "@/ui/List";
import { EmptyDetail, ListDetail } from "@/ui/ListDetail";
import { markPaneSwitch } from "@/ui/PaneVeil";
import { Screen, useAddInset } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { useTabBarCover } from "@/ui/tabBarMetrics";
import { useTransient } from "@/ui/transient";

export default function ActivityScreen() {
	const t = useTranslations("mobile.activity");
	const te = useTranslations("mobile.entry");
	const tc = useTranslations("mobile.common");
	const tr = useTranslations("mobile.recurring");
	const dayLabel = useDayLabel();
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const insets = useSafeAreaInsets();
	const addInset = useAddInset();
	const tabCover = useTabBarCover();
	const collapsing = useCollapsingBar();
	const barMetrics = useBarMetrics(collapsing?.footer ?? 0);
	const add = useOptionalAddEntry();
	const params = useLocalSearchParams<{ segment?: string }>();
	// On the iPad sidebar Recurring is a destination of its own.
	const [segment, setSegment] = useState<"expenses" | "recurring">(
		params.segment === "recurring" && !RECURRING_APART
			? "recurring"
			: "expenses",
	);
	// A link to a segment (Settings, a notification) opens it even when
	// Activity is already mounted on the other one.
	useEffect(() => {
		if (RECURRING_APART) return;
		if (params.segment === "recurring" || params.segment === "expenses") {
			markPaneSwitch();
			setSegment(params.segment);
		}
	}, [params.segment]);
	const [addingRecurring, setAddingRecurring] = useState(false);
	const [filter, setFilter] = useState(DEFAULT_FILTER);
	const [search, setSearch] = useDebouncedSearch((q) =>
		setFilter((f) => (f.q === q ? f : { ...f, q })),
	);
	const headerSearch = useHeaderSearch({
		enabled: !listDetail,
		onChange: setSearch,
		placeholder: segment === "recurring" ? tr("search") : t("search"),
		pill: true,
	});
	const [selected, setSelected] = useState<ActivityItem | null>(null);
	// An entry opened by a link (a Home row, a notification) fills the detail.
	const { link: linked, release: releaseLink } = useLinkedEntry();
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new link replaces the picked row
	useEffect(() => setSelected(null), [linked]);
	// Ids of the rows picked for a bulk action; null when not selecting.
	const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
	// Leaving the tab ends bulk select.
	useTransient(picked ? () => setPicked(null) : null);
	const { state, reload, loadMore, loadingMore } = useActivity(filter);
	const bulk = useBulkActions(() => setPicked(null));
	const deletePending = useDeletePending();
	// One entry from a row: the system alert after the server's dry run, then Undo.
	const deleteOne = useDeleteEntry();
	// Android: the floating toolbar takes the Add button's place while picking,
	// and the count and Done move to the top bar.
	const floatingBulk = Platform.OS === "android";
	useHideAddButton(floatingBulk && picked !== null);

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
		stashRow(item);
		router.push({ pathname: "/activity/[id]", params: { id: item.id } });
	}

	// The rows are memoized, so what they get must not change between
	// renders: `ops` and `onOpen` are stable and read the screen's latest
	// state through a ref.
	const latest = useRef({ add, bulk, open, deletePending, deleteOne });
	latest.current = { add, bulk, open, deletePending, deleteOne };
	const canEdit = add !== null;
	const ops = useMemo<RowOps>(
		() => ({
			words: {
				select: t("bulk.select"),
				edit: te("edit"),
				categorize: t("bulk.categorize"),
				delete: t("bulk.delete"),
			},
			canEdit,
			select: (item) => setPicked(new Set([item.id])),
			// An entry only this phone has edits and deletes where it waits.
			edit: (item) =>
				item.unsynced
					? latest.current.add?.editPending(item.entityId)
					: latest.current.add?.edit(
							item.entityId,
							item.source === "shared" ? "shared" : undefined,
						),
			categorize: (item) => latest.current.bulk.categorize([item.entityId]),
			remove: (item) =>
				item.unsynced
					? latest.current.deletePending({
							clientId: item.entityId,
							kind: item.kind,
							title: item.title,
						})
					: latest.current.deleteOne({
							id: item.entityId,
							shared: false,
							title: item.title,
						}),
		}),
		[t, te, canEdit],
	);
	const onOpen = useCallback(
		(item: ActivityItem) => latest.current.open(item),
		[],
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

	// The list, with its header (segments, search bar, summary, filters) on the
	// page, or without it as the results of the expanded search view.
	const rowsList = (withHeader: boolean) => (
		<BarSectionList
			contentInsetAdjustmentBehavior="automatic"
			extraData={picked}
			// One item is a whole day, so a few cover the first screen; the
			// window keeps what is near the viewport mounted.
			initialNumToRender={6}
			keyboardDismissMode="on-drag"
			keyboardShouldPersistTaps="handled"
			keyExtractor={(items) => items[0]?.id ?? "empty"}
			ListEmptyComponent={empty}
			ListFooterComponent={
				loadingMore ? (
					<SkeletonRows count={1} />
				) : (
					<View style={{ height: addInset }} />
				)
			}
			ListHeaderComponent={
				withHeader ? (
					<View>
						{segments}
						{headerSearch.pill}
						{page && !picked ? <ActivitySummary page={page} /> : null}
						<StaleNote
							since={state.status === "ready" ? state.staleSince : null}
						/>
						<SyncIssues padded />
						<ActivityFilters filter={filter} onChange={setFilter} />
					</View>
				) : undefined
			}
			// Over the rows: the pane's cover hangs from the tabs in this header.
			ListHeaderComponentStyle={{ zIndex: 1 }}
			onEndReached={loadMore}
			onEndReachedThreshold={0.6}
			onRefresh={reload}
			refreshing={false}
			removeClippedSubviews={Platform.OS === "android"}
			renderItem={({ item: items }) => (
				<ListGroup>
					{items.map((item) => (
						<ActivityRow
							checked={picked?.has(item.id)}
							item={item}
							key={item.id}
							onOpen={onOpen}
							ops={ops}
							picking={picked !== null}
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
			windowSize={7}
		/>
	);
	const rows = rowsList(true);
	// The phone's large-title bar is transparent over the list, so the bulk bar
	// takes its place at the top instead of sitting in the list's flow.
	// Android's collapsing bar is drawn over the list too, so the controls
	// cover it, at the height it has collapsed to.
	const overBar = (Platform.OS === "ios" && !listDetail) || collapsing !== null;
	const bulkBar = picked ? (
		<View
			pointerEvents={floatingBulk ? "box-none" : undefined}
			style={
				floatingBulk
					? {
							// Android: the floating toolbar over the foot of the list, above
							// the floating tab bar (its cover is the bar and the gesture area).
							position: "absolute",
							bottom: space[4] + tabCover,
							left: space[4],
							right: space[4],
							zIndex: 2,
						}
					: collapsing
						? {
								position: "absolute",
								top: 0,
								left: 0,
								right: 0,
								height: barMetrics.collapsed,
								justifyContent: "flex-end",
								backgroundColor: color.raised,
								zIndex: 3,
							}
						: overBar
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
	) : null;
	// Over the bar the controls float, so the list stays the first child (the
	// system finds the scroll view behind the large title through it); in the
	// flow they sit above the rows.
	const list = picked ? (
		<View style={{ flex: 1 }}>
			{overBar || floatingBulk ? null : bulkBar}
			{rows}
			{overBar || floatingBulk ? bulkBar : null}
		</View>
	) : (
		rows
	);

	const recurring = (withHeader: boolean) => (
		<RecurringView
			adding={withHeader && addingRecurring}
			embedded
			header={
				withHeader ? (
					<>
						{segments}
						{headerSearch.pill}
					</>
				) : undefined
			}
			onAdd={() => setAddingRecurring(true)}
			onAddClose={() => setAddingRecurring(false)}
			query={search}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{headerSearch.view(
				segment === "recurring" ? recurring(false) : rowsList(false),
			)}
			<ListDetail
				bar={
					<AccountTopBar
						actions={[
							// Android: Done leaves bulk select from the top bar.
							...(floatingBulk && picked
								? [
										{
											id: "done",
											icon: "X" as const,
											label: t("bulk.done"),
											onPress: () => setPicked(null),
										},
									]
								: []),
							...(headerSearch.action ? [headerSearch.action] : []),
							...(segment === "recurring"
								? [
										{
											id: "add-recurring",
											icon: "Plus" as const,
											label: tr("add.title"),
											onPress: () => setAddingRecurring(true),
										},
									]
								: []),
						]}
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
						title={
							floatingBulk && picked
								? picked.size > 0
									? t("bulk.selected", {
											count: entityIdsOf(page?.items ?? [], picked).length,
										})
									: t("bulk.pickSome")
								: t("title")
						}
					/>
				}
				detail={
					segment === "recurring" ? (
						<EmptyDetail title={tr("pick")} />
					) : !selected && !linked ? (
						<EmptyDetail title={t("pick")} />
					) : (
						<Screen>
							{selected ? (
								<EntryDetail id={selected.id} placeholder={selected} />
							) : linked ? (
								<EntryDetail id={linked.id} placeholder={linked.placeholder} />
							) : null}
						</Screen>
					)
				}
				list={
					<View key={segment} style={{ flex: 1 }}>
						{segment === "recurring" ? recurring(true) : list}
					</View>
				}
				search={{
					value: search,
					onChange: setSearch,
					placeholder: segment === "recurring" ? tr("search") : t("search"),
					ref: headerSearch.ref,
				}}
			/>
			{bulk.sheets}
		</View>
	);
}
