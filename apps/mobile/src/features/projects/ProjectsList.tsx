import { router, Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { SectionList, View } from "react-native";
import { useTranslations } from "use-intl";
import { ProjectRow } from "@/features/projects/ProjectRow";
import { ProjectView } from "@/features/projects/ProjectView";
import { groupProjects, matchesProject } from "@/features/projects/source";
import { useProjectList } from "@/features/projects/useProjects";
import { SectionHeader, StaleNote } from "@/features/read/parts";
import { projectRoute } from "@/layout/destinations";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListDetail } from "@/ui/ListDetail";
import { Screen } from "@/ui/Screen";

function openProject(id: string) {
	router.push(projectRoute(id));
}

/**
 * The Projects list (and its detail pane on wide windows), without a top bar.
 * With `query` the parent (PeopleHub) owns the search text and the search bar.
 */
export function ProjectsList({
	top,
	query: sharedQuery,
}: {
	top?: ReactNode;
	query?: string;
}) {
	const t = useTranslations("mobile.projects");
	const { color } = useTheme();
	const { listDetail } = useLayoutClass();
	const searchRef = useSearchShortcut(sharedQuery === undefined);
	const { state, reload } = useProjectList();
	const [ownQuery, setQuery] = useState("");
	const query = sharedQuery ?? ownQuery;
	const [selected, setSelected] = useState<string | null>(null);

	const items = state.status === "ready" ? state.data.items : null;
	const sections = useMemo(
		() =>
			items
				? groupProjects(items.filter((p) => matchesProject(p, query))).map(
						(group) => ({ ...group, data: group.projects }),
					)
				: [],
		[items, query],
	);

	const empty =
		state.status === "loading" ? (
			<EmptyState title={t("title")} />
		) : state.status === "error" ? (
			<EmptyState detail={t("errorDetail")} title={t("error")} />
		) : (
			<EmptyState
				detail={query === "" ? t("emptyDetail") : undefined}
				title={query === "" ? t("empty") : t("noMatch")}
			/>
		);

	const list = (
		<SectionList
			contentInsetAdjustmentBehavior="automatic"
			keyExtractor={(item) => item.id}
			ListEmptyComponent={empty}
			ListHeaderComponent={
				<View>
					{top}
					{state.status === "ready" ? (
						<StaleNote since={state.staleSince} />
					) : null}
				</View>
			}
			onRefresh={reload}
			refreshing={false}
			renderItem={({ item }) => (
				<ProjectRow
					onPress={() =>
						listDetail ? setSelected(item.id) : openProject(item.id)
					}
					project={item}
					selected={listDetail && selected === item.id}
				/>
			)}
			renderSectionHeader={({ section }) => (
				<View style={{ backgroundColor: color.bg }}>
					<SectionHeader
						detail={String(section.projects.length)}
						title={
							section.kind === "active"
								? t("group.active")
								: String(section.year)
						}
					/>
				</View>
			)}
			sections={sections}
			stickySectionHeadersEnabled={false}
			style={{ backgroundColor: color.bg }}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{sharedQuery === undefined ? (
				<Stack.Screen
					options={{
						headerSearchBarOptions: {
							ref: searchRef,
							placeholder: t("search"),
							onChangeText: (event) => setQuery(event.nativeEvent.text),
						},
					}}
				/>
			) : null}
			<ListDetail
				detail={
					selected ? (
						<ProjectView id={selected} key={selected} />
					) : (
						<Screen>
							<EmptyState title={t("pick")} />
						</Screen>
					)
				}
				list={list}
			/>
		</View>
	);
}
