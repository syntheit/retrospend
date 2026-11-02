import { router, Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAddButtonScroll } from "@/features/entry/addEntryContext";
import {
	type PeopleChip,
	type PeopleSort,
	sectionsOf,
} from "@/features/people/groups";
import { NeedsCard } from "@/features/people/NeedsCard";
import { PeopleTop } from "@/features/people/PeopleTop";
import { PersonRow } from "@/features/people/PersonRow";
import { PersonView } from "@/features/people/PersonView";
import { keyOf, type PersonRef, refOfKey } from "@/features/people/source";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { BarFlatList } from "@/ui/barScroll";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { EmptyDetail, ListDetail } from "@/ui/ListDetail";
import { Menu } from "@/ui/Menu";
import { useAddInset } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";

/** The chips narrow the list; pressing the one that is on turns it off. */
const CHIPS: Exclude<PeopleChip, "all">[] = [
	"owesYou",
	"youOwe",
	"notOnRetrospend",
];
const SORTS: PeopleSort[] = ["balance", "recent", "name"];

function openPerson(ref: PersonRef) {
	router.push({
		pathname: "/people/[type]/[id]",
		params: { type: ref.type, id: ref.id },
	});
}

/** Search text, chip and sort a parent keeps for the list (PeopleHub), so a segment switch does not reset them. */
export interface PeopleFilters {
	query: string;
	chip: PeopleChip;
	onChip(chip: PeopleChip): void;
	sort: PeopleSort;
	onSort(sort: PeopleSort): void;
}

/**
 * The People list (and its detail pane on wide windows), without a top bar.
 * With `filters` the parent owns the search text, the chip and the sort, and
 * the search bar; alone, the list keeps its own.
 */
export function PeopleList({
	top,
	filters,
	bar,
	bare = false,
}: {
	/** What leads the list's header (the tabs, the search bar). */
	top?: ReactNode;
	filters?: PeopleFilters;
	/** The screen's top bar; a list-detail pair draws it over the list pane. */
	bar?: ReactNode;
	/** Only the rows, for the results of the expanded search view. */
	bare?: boolean;
}) {
	const t = useTranslations("mobile.people");
	const tc = useTranslations("mobile.common");
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const inset = useAddInset();
	const fabScroll = useAddButtonScroll();
	const searchRef = useSearchShortcut(filters === undefined);
	const { state, reload } = usePeopleOverview();
	const [ownChip, setOwnChip] = useState<PeopleChip>("all");
	const [ownSort, setOwnSort] = useState<PeopleSort>("balance");
	const [ownQuery, setQuery] = useState("");
	const chip = filters ? filters.chip : ownChip;
	const setChip = filters ? filters.onChip : setOwnChip;
	const sort = filters ? filters.sort : ownSort;
	const setSort = filters ? filters.onSort : setOwnSort;
	const query = filters ? filters.query : ownQuery;
	const [selected, setSelected] = useState<PersonRef | null>(null);

	const overview = state.status === "ready" ? state.data : null;
	const sections = useMemo(
		() => (overview ? sectionsOf(overview.people, chip, query, sort) : []),
		[overview, chip, query, sort],
	);

	function open(ref: PersonRef) {
		if (listDetail) setSelected(ref);
		else openPerson(ref);
	}

	const empty =
		state.status === "loading" ? (
			<SkeletonRows />
		) : state.status === "error" ? (
			<EmptyState
				actionLabel={tc("retry")}
				detail={t("errorDetail")}
				onAction={() => void reload()}
				title={t("error")}
			/>
		) : (
			<EmptyState
				detail={query === "" && chip === "all" ? t("emptyDetail") : undefined}
				title={query === "" && chip === "all" ? t("empty") : t("noMatch")}
			/>
		);

	const firstNeed = overview?.needs[0];
	const firstNeedRef = firstNeed ? refOfKey(firstNeed.person.key) : null;

	const list = (
		<BarFlatList
			{...fabScroll}
			contentInsetAdjustmentBehavior="automatic"
			data={sections}
			keyboardDismissMode="on-drag"
			keyboardShouldPersistTaps="handled"
			keyExtractor={(section) => section.group}
			ListEmptyComponent={empty}
			ListFooterComponent={<View style={{ height: inset }} />}
			ListHeaderComponent={
				bare ? undefined : (
					<View>
						{top}
						{overview ? (
							<View style={{ gap: space[3] }}>
								<StaleNote
									since={state.status === "ready" ? state.staleSince : null}
								/>
								<PeopleTop
									onPerson={(key) => {
										const ref = refOfKey(key);
										if (ref) open(ref);
									}}
									overview={overview}
								/>
								<NeedsCard
									needs={overview.needs}
									onPress={() => {
										if (firstNeedRef) open(firstNeedRef);
									}}
								/>
								<ScrollView
									contentContainerStyle={{
										alignItems: "center",
										gap: space[2],
										paddingHorizontal: space[4],
									}}
									horizontal
									keyboardShouldPersistTaps="handled"
									showsHorizontalScrollIndicator={false}
								>
									{CHIPS.map((id) => (
										<Chip
											key={id}
											label={t(`chip.${id}`)}
											onPress={() => setChip(chip === id ? "all" : id)}
											selected={chip === id}
										/>
									))}
									<Menu
										accessibilityLabel={t("sortBy", {
											sort: t(`sort.${sort}`),
										})}
										active={sort !== "balance"}
										items={SORTS.map((id) => ({
											id,
											label: t(`sort.${id}`),
											onPress: () => setSort(id),
										}))}
										label={t(`sort.${sort}`)}
										sortIcon
									/>
								</ScrollView>
							</View>
						) : null}
					</View>
				)
			}
			// Over the rows: the pane cover hangs from the tabs in this header.
			ListHeaderComponentStyle={{ zIndex: 1 }}
			onRefresh={reload}
			refreshing={false}
			renderItem={({ item: section }) => (
				<View>
					<SectionHeader
						detail={String(section.people.length)}
						title={t(`group.${section.group}`)}
					/>
					<ListGroup>
						{section.people.map((item) => {
							const ref = { type: item.person.type, id: item.person.id };
							return (
								<PersonRow
									home={overview?.home ?? ""}
									key={item.person.key}
									onPress={() => open(ref)}
									selected={
										listDetail &&
										selected !== null &&
										keyOf(selected) === item.person.key
									}
									summary={item}
								/>
							);
						})}
					</ListGroup>
				</View>
			)}
			style={{ backgroundColor: color.bg }}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{filters || listDetail ? null : (
				<Stack.Screen
					options={{
						headerSearchBarOptions: {
							ref: searchRef,
							placeholder: t("search"),
							onChangeText: (event) => setQuery(event.nativeEvent.text),
						},
					}}
				/>
			)}
			<ListDetail
				bar={bar}
				detail={
					selected ? (
						<PersonView key={keyOf(selected)} person={selected} />
					) : (
						<EmptyDetail title={t("pick")} />
					)
				}
				list={list}
				search={
					filters
						? undefined
						: {
								value: query,
								onChange: setQuery,
								placeholder: t("search"),
								ref: searchRef,
							}
				}
			/>
		</View>
	);
}
