import type { SearchHit } from "@retrospend/api-contract";
import { router, Stack } from "expo-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { Cover } from "@/features/projects/Cover";
import { openProject } from "@/features/projects/openProject";
import { entryHref, personHref } from "@/layout/detailRoutes";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { StatusText } from "@/ui/StatusText";
import { clearRecents, readRecents, rememberSearch } from "./recents";
import {
	groupsOf,
	matchPlaces,
	type Place,
	places,
	type SearchGroup,
} from "./rules";
import { useSearch } from "./useSearch";

/**
 * Search: one field in the bar, then the server's answer in groups
 * (Expenses, People, Projects) with the pages that match under Go to. With
 * nothing typed it lists the searches you ran lately and every page. A tap
 * opens the item and keeps what was typed as a recent search.
 */
export function SearchScreen() {
	const t = useTranslations("mobile.search");
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const { size } = useTheme();
	const searchRef = useSearchShortcut();
	const [text, setText] = useState("");
	const [recents, setRecents] = useState<string[]>(() => readRecents());
	const { query, state, retry } = useSearch(text);

	// The field is the screen: the cursor is in it when it opens.
	useEffect(() => {
		const timer = setTimeout(() => searchRef.current?.focus(), 100);
		return () => clearTimeout(timer);
	}, [searchRef]);

	const all = useMemo(() => places(), []);
	const nameOf = (place: Place) => t(`places.${place.label}` as never);
	const goTo = matchPlaces(all, nameOf, query);

	function keep() {
		if (query !== "") setRecents(rememberSearch(query));
	}

	function open(go: () => void) {
		keep();
		go();
	}

	function openPlace(place: Place) {
		open(() =>
			place.tab
				? router.navigate(place.href as never)
				: router.push(place.href as never),
		);
	}

	const heading: Record<SearchGroup, string> = {
		expenses: t("expenses"),
		people: t("people"),
		projects: t("projects"),
	};

	function hitRow(hit: SearchHit) {
		switch (hit.type) {
			case "expense":
				return (
					<ListRow
						end={<MoneyAmount value={hit.amount} />}
						key={hit.id}
						lead={<IconTile name="Receipt" />}
						onPress={() =>
							open(() =>
								router.push(entryHref(hit.id, true)),
							)
						}
						sub={format.dateTime(new Date(`${hit.date}T12:00:00`), {
							dateStyle: "medium",
						})}
						title={hit.title}
					/>
				);
			case "person":
				return (
					<ListRow
						key={hit.id}
						lead={
							<Avatar
								face={{
									key: `${hit.participantType}:${hit.id}`,
									name: hit.name,
								}}
								offApp={hit.participantType === "shadow"}
								size="default"
							/>
						}
						onPress={() =>
							open(() =>
								router.push(personHref(hit.participantType, hit.id, true)),
							)
						}
						sub={hit.username ? `@${hit.username}` : undefined}
						title={hit.name}
					/>
				);
			case "project":
				return (
					<ListRow
						end={
							hit.status === "ARCHIVED" ? (
								<StatusText
									label={t("archived")}
									size="sm"
									tone="muted"
								/>
							) : undefined
						}
						key={hit.id}
						lead={
							<Cover
								diameter={size.avatar.default}
								id={hit.id}
								imageUri={null}
								name={hit.name}
							/>
						}
						onPress={() => open(() => openProject(hit, {}, true))}
						title={hit.name}
					/>
				);
			default:
				return null;
		}
	}

	const typing = query !== "";
	const groups = state.status === "ready" ? groupsOf(state.result) : [];
	const nothing =
		state.status === "ready" && groups.length === 0 && goTo.length === 0;

	return (
		<>
			<Stack.Screen
				options={{
					title: t("title"),
					headerLargeTitle: false,
					headerSearchBarOptions: {
						ref: searchRef,
						placeholder: t("placeholder"),
						autoCapitalize: "none",
						hideWhenScrolling: false,
						onChangeText: (event) => setText(event.nativeEvent.text),
						onSearchButtonPress: keep,
					},
				}}
			/>
			<Screen flush>
				{!typing ? (
					<>
						{recents.length > 0 ? (
							<>
								<SectionHeader
									actionLabel={t("clear")}
									onAction={() => {
										clearRecents();
										setRecents([]);
									}}
									title={t("recent")}
								/>
								<ListGroup>
									{recents.map((item) => (
										<ListRow
											key={item}
											onPress={() => {
												setText(item);
												searchRef.current?.setText(item);
											}}
											title={item}
										/>
									))}
								</ListGroup>
							</>
						) : null}
					</>
				) : state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={retry}
						title={t("error")}
					/>
				) : state.status !== "ready" ? (
					<SkeletonRows />
				) : (
					groups.map((group) => (
						<ListGroupWithHeader
							heading={heading[group.type]}
							key={group.type}
						>
							{group.items.map(hitRow)}
						</ListGroupWithHeader>
					))
				)}
				{goTo.length > 0 && (!typing || state.status === "ready") ? (
					<ListGroupWithHeader heading={t("goTo")}>
						{goTo.map((place) => (
							<ListRow
								key={place.id}
								lead={<IconTile name={place.glyph} />}
								onPress={() => openPlace(place)}
								title={nameOf(place)}
							/>
						))}
					</ListGroupWithHeader>
				) : null}
				{nothing ? <EmptyState title={t("empty", { query })} /> : null}
			</Screen>
		</>
	);
}

function ListGroupWithHeader({
	heading,
	children,
}: {
	heading: string;
	children: ReactNode;
}) {
	return (
		<>
			<SectionHeader title={heading} />
			<ListGroup>{children}</ListGroup>
		</>
	);
}
