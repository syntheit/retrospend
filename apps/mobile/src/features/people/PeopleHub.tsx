import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ProjectsList } from "@/features/projects/ProjectsList";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useTheme } from "@/theme";
import { usePaneEnter } from "@/ui/motion";
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
import { useExpensesExport } from "./useExpensesExport";

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
	const more = useTranslations("mobile.activity")("overflow");
	const overflow = useExpensesExport();
	const searchRef = useSearchShortcut();
	const { segment: requested } = useLocalSearchParams<{ segment?: string }>();
	const [segment, setSegment] = useState<PeopleSegment>(
		() => parseSegment(requested) ?? readSegment(),
	);

	const [query, setQuery] = useState("");
	const [chip, setChip] = useState<PeopleChip>("all");
	const [sort, setSort] = useState<PeopleSort>("balance");
	const paneEnter = usePaneEnter(segment === "people" ? 0 : 1);

	useEffect(() => {
		const next = parseSegment(requested);
		if (next) setSegment(next);
	}, [requested]);

	function choose(next: PeopleSegment) {
		setSegment(next);
		writeSegment(next);
		// The param must follow the choice: a later link to the segment it
		// still names would otherwise look like no change.
		router.setParams({ segment: next });
	}

	const switcher = (
		<View style={{ paddingBottom: space[2], backgroundColor: color.bg }}>
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
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{/*
			 * The list is the first child, then the bars: the system finds the
			 * scroll view behind the large title and search through the first
			 * child of each view, and the account sheet is a native view (see
			 * ListDetail).
			 */}
			<Animated.View entering={paneEnter} key={segment} style={{ flex: 1 }}>
				{segment === "people" ? (
					<PeopleList
						filters={{ query, chip, onChip: setChip, sort, onSort: setSort }}
						top={switcher}
					/>
				) : (
					<ProjectsList query={query} top={switcher} />
				)}
			</Animated.View>
			{segment === "people" ? (
				<PeopleTopBar title={t("peopleSegment")} />
			) : (
				<AccountTopBar
					overflow={overflow}
					overflowLabel={more}
					title={t("projects")}
				/>
			)}
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						ref: searchRef,
						placeholder: segment === "people" ? tp("search") : tj("search"),
						onChangeText: (event) => setQuery(event.nativeEvent.text),
					},
				}}
			/>
		</View>
	);
}
