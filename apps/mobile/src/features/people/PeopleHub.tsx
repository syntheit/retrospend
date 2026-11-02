import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { ProjectsList } from "@/features/projects/ProjectsList";
import { ProjectsTopBar } from "@/features/projects/ProjectsTopBar";
import { useHeaderSearch } from "@/layout/headerSearch";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { useCollapsingBar } from "@/ui/barScroll";
import { LAYER } from "@/ui/metrics";
import { usePaneEnter } from "@/ui/motion";
import { markPaneSwitch, PaneVeil } from "@/ui/PaneVeil";
import { UnderlineTabs } from "@/ui/UnderlineTabs";
import type { PeopleChip, PeopleSort } from "./groups";
import { PeopleList } from "./PeopleList";
import { PeopleTopBar } from "./PeopleTopBar";
import {
	type PeopleSegment,
	parseSegment,
	readSegment,
	writeSegment,
} from "./segment";

/**
 * The People tab on phones: People and Projects behind underline tabs at
 * the top of the list (the fifth bar slot belongs to Add). The last
 * choice is remembered; a link or redirect that names a segment wins. The
 * search text and the people chip live here, so a switch does not reset them.
 */
export function PeopleHub() {
	const t = useTranslations("mobile.tabs");
	const tp = useTranslations("mobile.people");
	const tj = useTranslations("mobile.projects");
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	// On an Android phone the tab row stays above the lists, mounted across a
	// switch, so the line slides to the tab (M3 tabs are fixed, not part of the
	// scroll). iOS and the wide Android pair keep it in each list's header.
	const fixedTabs = Platform.OS === "android" && !listDetail;
	// With the large bar the row rides under it (the bar's footer) and scrolls
	// no part of the page.
	const pinned = useCollapsingBar() !== null;
	const { segment: requested } = useLocalSearchParams<{ segment?: string }>();
	const [segment, setSegment] = useState<PeopleSegment>(
		() => parseSegment(requested) ?? readSegment(),
	);

	const [query, setQuery] = useState("");
	const headerSearch = useHeaderSearch({
		onChange: setQuery,
		placeholder: segment === "people" ? tp("search") : tj("search"),
		pill: true,
	});
	const [chip, setChip] = useState<PeopleChip>("all");
	const [sort, setSort] = useState<PeopleSort>("balance");
	const paneEnter = usePaneEnter(segment === "people" ? 0 : 1);

	useEffect(() => {
		const next = parseSegment(requested);
		if (next) {
			markPaneSwitch();
			setSegment(next);
		}
	}, [requested]);

	function choose(next: PeopleSegment) {
		markPaneSwitch();
		setSegment(next);
		writeSegment(next);
		// The param must follow the choice: a later link to the segment it
		// still names would otherwise look like no change.
		router.setParams({ segment: next });
	}

	const switcher = (
		<View style={{ zIndex: LAYER.above }}>
			{/* Pinned in the large bar, the row takes the bar's tone. */}
			<View
				style={{
					paddingBottom: space[2],
					backgroundColor: fixedTabs ? undefined : color.bg,
				}}
			>
				<UnderlineTabs
					accessibilityLabel={tp("segmentLabel")}
					onChange={choose}
					tabs={[
						{ value: "people", label: t("peopleSegment") },
						{ value: "projects", label: t("projects") },
					]}
					value={segment}
				/>
			</View>
			{/* In the list's header the new pane fades in under the tabs. */}
			{fixedTabs ? null : <PaneVeil />}
		</View>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{fixedTabs && !pinned ? switcher : null}
			{/*
			 * The list is the first child, then the bars: the system finds the
			 * scroll view behind the large title and search through the first
			 * child of each view, and the account sheet is a native view (see
			 * ListDetail).
			 */}
			<Animated.View
				entering={fixedTabs ? paneEnter : undefined}
				key={segment}
				style={{ flex: 1 }}
			>
				{segment === "people" ? (
					<PeopleList
						filters={{ query, chip, onChip: setChip, sort, onSort: setSort }}
						top={fixedTabs ? (headerSearch.pill ?? undefined) : switcher}
					/>
				) : (
					<ProjectsList
						query={query}
						top={fixedTabs ? (headerSearch.pill ?? undefined) : switcher}
					/>
				)}
			</Animated.View>
			{segment === "people" ? (
				<PeopleTopBar
					footer={pinned ? switcher : undefined}
					search={headerSearch.action}
					title={t("peopleSegment")}
				/>
			) : (
				<ProjectsTopBar
					footer={pinned ? switcher : undefined}
					search={headerSearch.action}
					title={t("projects")}
				/>
			)}
			{headerSearch.view(
				segment === "people" ? (
					<PeopleList
						bare
						filters={{ query, chip, onChip: setChip, sort, onSort: setSort }}
					/>
				) : (
					<ProjectsList bare query={query} />
				),
			)}
		</View>
	);
}
