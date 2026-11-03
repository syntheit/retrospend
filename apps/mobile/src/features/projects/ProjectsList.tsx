import { Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { openProject } from "@/features/projects/openProject";
import { ProjectCard } from "@/features/projects/ProjectCard";
import { ProjectRow } from "@/features/projects/ProjectRow";
import { ProjectView } from "@/features/projects/ProjectView";
import {
	groupProjects,
	justBack,
	matchesProject,
} from "@/features/projects/source";
import { useProjectMenu } from "@/features/projects/useProjectMenu";
import { useProjectList } from "@/features/projects/useProjects";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { dayKey } from "@/lib/days";
import { useTheme } from "@/theme";
import { BarFlatList } from "@/ui/barScroll";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { EmptyDetail, ListDetail } from "@/ui/ListDetail";
import { LAYER } from "@/ui/metrics";
import { useAddInset } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";

/** The phone's today as a YYYY-MM-DD day; the list carries no server day. */
const todayDay = () => dayKey(new Date());

/**
 * The Projects list (and its detail pane on wide windows), without a top bar.
 * With `query` the parent (PeopleHub) owns the search text and the search bar.
 */
export function ProjectsList({
	top,
	query: sharedQuery,
	bar,
	bare = false,
}: {
	/** What leads the list's header (the tabs, the search bar). */
	top?: ReactNode;
	query?: string;
	/** The screen's top bar; a list-detail pair draws it over the list pane. */
	bar?: ReactNode;
	/** Only the rows, for the results of the expanded search view. */
	bare?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const tc = useTranslations("mobile.common");
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const inset = useAddInset();
	const searchRef = useSearchShortcut(sharedQuery === undefined);
	const { state, reload } = useProjectList();
	const [ownQuery, setQuery] = useState("");
	const query = sharedQuery ?? ownQuery;
	const [selected, setSelected] = useState<string | null>(null);

	const items = state.status === "ready" ? state.data.items : null;
	const today = todayDay();
	const shown = useMemo(
		() => (items ? items.filter((p) => matchesProject(p, query)) : []),
		[items, query],
	);
	// Layout A: the project you just came back from leads as the hero, the
	// other active ones are cover cards, archived ones stay compact rows.
	// The search results are rows only, so the hero has no card to lead them.
	const hero = useMemo(
		() => (bare ? null : justBack(shown, todayDay())),
		[shown, bare],
	);
	const sections = useMemo(
		() => groupProjects(shown.filter((p) => p !== hero)),
		[shown, hero],
	);

	const menuOf = useProjectMenu(
		(project, then) =>
			listDetail
				? setSelected(project.id)
				: openProject(project, { sheet: then }),
		reload,
		(project) =>
			listDetail
				? setSelected(project.id)
				: openProject(project, { add: true }),
	);

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
				detail={query === "" ? t("emptyDetail") : undefined}
				title={query === "" ? t("empty") : t("noMatch")}
			/>
		);

	const list = (
		<BarFlatList
			contentInsetAdjustmentBehavior="automatic"
			data={sections}
			keyboardDismissMode="on-drag"
			keyboardShouldPersistTaps="handled"
			keyExtractor={(group) => group.key}
			ListEmptyComponent={empty}
			ListFooterComponent={<View style={{ height: inset }} />}
			ListHeaderComponent={
				bare ? undefined : (
					<View>
						{top}
						{state.status === "ready" ? (
							<StaleNote since={state.staleSince} />
						) : null}
						{hero ? (
							<View style={{ paddingTop: space[4] }}>
								<ProjectCard
									hero
									menu={menuOf(hero)}
									onPress={() =>
										listDetail ? setSelected(hero.id) : openProject(hero)
									}
									onSettle={() =>
										listDetail
											? setSelected(hero.id)
											: openProject(hero, { settle: true })
									}
									project={hero}
									today={today}
								/>
							</View>
						) : null}
					</View>
				)
			}
			// Over the rows: the pane cover hangs from the tabs in this header.
			ListHeaderComponentStyle={{ zIndex: LAYER.above }}
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
					{group.kind === "active" ? (
						<View style={{ gap: space[3] }}>
							{group.projects.map((project) => (
								<ProjectCard
									key={project.id}
									menu={menuOf(project)}
									onPress={() =>
										listDetail ? setSelected(project.id) : openProject(project)
									}
									project={project}
									today={today}
								/>
							))}
						</View>
					) : (
						<ListGroup>
							{group.projects.map((project) => (
								<ProjectRow
									key={project.id}
									menu={menuOf(project)}
									onPress={() =>
										listDetail ? setSelected(project.id) : openProject(project)
									}
									project={project}
									selected={listDetail && selected === project.id}
								/>
							))}
						</ListGroup>
					)}
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
						<EmptyDetail title={t("pick")} />
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
