import { router, Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useTranslations } from "use-intl";
import { ProjectRow } from "@/features/projects/ProjectRow";
import { ProjectView } from "@/features/projects/ProjectView";
import { groupProjects, matchesProject } from "@/features/projects/source";
import { useProjectList } from "@/features/projects/useProjects";
import { projectRoute } from "@/layout/destinations";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { ListDetail } from "@/ui/ListDetail";
import { Screen, useAddInset } from "@/ui/Screen";

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
	bar,
}: {
	top?: ReactNode;
	query?: string;
	/** The screen's top bar; a list-detail pair draws it over the list pane. */
	bar?: ReactNode;
}) {
	const t = useTranslations("mobile.projects");
	const { color } = useTheme();
	const { listDetail } = useLayoutClass();
	const inset = useAddInset();
	const searchRef = useSearchShortcut(sharedQuery === undefined);
	const { state, reload } = useProjectList();
	const [ownQuery, setQuery] = useState("");
	const query = sharedQuery ?? ownQuery;
	const [selected, setSelected] = useState<string | null>(null);

	const items = state.status === "ready" ? state.data.items : null;
	const sections = useMemo(
		() =>
			items ? groupProjects(items.filter((p) => matchesProject(p, query))) : [],
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
		<FlatList
			contentInsetAdjustmentBehavior="automatic"
			data={sections}
			keyboardDismissMode="on-drag"
			keyExtractor={(group) => group.key}
			ListEmptyComponent={empty}
			ListFooterComponent={<View style={{ height: inset }} />}
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
			renderItem={({ item: group }) => (
				<View>
					<SectionHeader
						detail={String(group.projects.length)}
						title={
							group.kind === "active" ? t("group.active") : String(group.year)
						}
					/>
					<ListGroup>
						{group.projects.map((project) => (
							<ProjectRow
								key={project.id}
								onPress={() =>
									listDetail ? setSelected(project.id) : openProject(project.id)
								}
								project={project}
								selected={listDetail && selected === project.id}
							/>
						))}
					</ListGroup>
				</View>
			)}
			style={{ backgroundColor: color.bg }}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{sharedQuery === undefined && !listDetail ? (
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
				bar={bar}
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
				search={
					sharedQuery === undefined
						? {
								value: query,
								onChange: setQuery,
								placeholder: t("search"),
								ref: searchRef,
							}
						: undefined
				}
			/>
		</View>
	);
}
