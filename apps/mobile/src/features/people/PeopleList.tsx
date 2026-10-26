import { router, Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { SectionList, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { type PeopleChip, sectionsOf } from "@/features/people/groups";
import { NetAmount } from "@/features/people/NetAmount";
import { PersonRow } from "@/features/people/PersonRow";
import { PersonView } from "@/features/people/PersonView";
import {
	keyOf,
	type PeopleOverview,
	type PersonRef,
	refOfKey,
} from "@/features/people/source";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useFaces } from "@/features/read/faces";
import { ListRow, SectionHeader, StaleNote } from "@/features/read/parts";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { ListDetail } from "@/ui/ListDetail";
import { Menu } from "@/ui/Menu";
import { Screen } from "@/ui/Screen";

const CHIPS: PeopleChip[] = ["all", "owesYou", "youOwe", "notOnRetrospend"];

function openPerson(ref: PersonRef) {
	router.push({
		pathname: "/people/[type]/[id]",
		params: { type: ref.type, id: ref.id },
	});
}

/** Owed to you and You owe, side by side in meaning, never netted. */
function Totals({ overview }: { overview: PeopleOverview }) {
	const t = useTranslations("mobile.people");
	const { color, space, type } = useTheme();
	const parts = overview.people.flatMap((p) => p.parts);
	// Each total is an estimate only from the parts on its own side.
	const owedParts = parts.filter((p) => p.amount.minor > 0);
	const oweParts = parts.filter((p) => p.amount.minor < 0);
	return (
		<View style={{ gap: space[1], padding: space[4] }}>
			<Text style={{ color: color.fg2, fontSize: type.body.size }}>
				{t("owedToYou")}
			</Text>
			<NetAmount
				align="left"
				home={overview.home}
				net={overview.owedToYou}
				parts={owedParts}
				showCount={false}
				size="hero"
				tone="positive"
			/>
			<View
				style={{
					flexDirection: "row",
					alignItems: "baseline",
					gap: space[2],
					paddingTop: space[2],
				}}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("youOwe")}
				</Text>
				<NetAmount
					align="left"
					home={overview.home}
					net={overview.youOwe}
					parts={oweParts}
					showCount={false}
					tone="default"
				/>
			</View>
			{overview.unpriced.length > 0 ? (
				<Text style={{ color: color.attentionText, fontSize: type.small.size }}>
					{t("unpriced", { currencies: overview.unpriced.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}

/** One line that opens the first person who is waiting on you. */
function NeedsStrip({ overview }: { overview: PeopleOverview }) {
	const t = useTranslations("mobile.people");
	const faces = useFaces();
	const { color, type } = useTheme();
	const first = overview.needs[0];
	if (!first) return null;
	const ref = refOfKey(first.person.key);
	const people = [
		...new Map(overview.needs.map((n) => [n.person.key, n.person])).values(),
	];
	return (
		<ListRow
			accessibilityLabel={`${t("needsYou", { count: overview.needs.length })}, ${people.map((p) => p.name).join(", ")}`}
			onPress={ref ? () => openPerson(ref) : undefined}
		>
			<AvatarStack faces={faces(people)} />
			<Text
				style={{
					flex: 1,
					color: color.attentionText,
					fontSize: type.body.size,
					fontWeight: "500",
				}}
			>
				{t("needsYou", { count: overview.needs.length })}
			</Text>
		</ListRow>
	);
}

/** Search text and chip a parent keeps for the list (PeopleHub), so a segment switch does not reset them. */
export interface PeopleFilters {
	query: string;
	chip: PeopleChip;
	onChip(chip: PeopleChip): void;
}

/**
 * The People list (and its detail pane on wide windows), without a top bar.
 * With `filters` the parent owns the search text and the chip, and the search
 * bar; alone, the list keeps its own.
 */
export function PeopleList({
	top,
	filters,
}: {
	top?: ReactNode;
	filters?: PeopleFilters;
}) {
	const t = useTranslations("mobile.people");
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const { state, reload } = usePeopleOverview();
	const [ownChip, setOwnChip] = useState<PeopleChip>("all");
	const [ownQuery, setQuery] = useState("");
	const chip = filters ? filters.chip : ownChip;
	const setChip = filters ? filters.onChip : setOwnChip;
	const query = filters ? filters.query : ownQuery;
	const [selected, setSelected] = useState<PersonRef | null>(null);

	const overview = state.status === "ready" ? state.data : null;
	const sections = useMemo(
		() =>
			overview
				? sectionsOf(overview.people, chip, query).map((s) => ({
						...s,
						data: s.people,
					}))
				: [],
		[overview, chip, query],
	);

	const empty =
		state.status === "loading" ? (
			<EmptyState title={t("title")} />
		) : state.status === "error" ? (
			<EmptyState detail={t("errorDetail")} title={t("error")} />
		) : (
			<EmptyState
				detail={query === "" && chip === "all" ? t("emptyDetail") : undefined}
				title={query === "" && chip === "all" ? t("empty") : t("noMatch")}
			/>
		);

	const list = (
		<SectionList
			contentInsetAdjustmentBehavior="automatic"
			keyExtractor={(item) => item.person.key}
			ListEmptyComponent={empty}
			ListHeaderComponent={
				<View>
					{top}
					{overview ? (
						<View>
							<StaleNote
								since={state.status === "ready" ? state.staleSince : null}
							/>
							<Totals overview={overview} />
							<NeedsStrip overview={overview} />
							<View
								style={{ paddingHorizontal: space[4], paddingTop: space[2] }}
							>
								<Menu
									items={CHIPS.map((id) => ({
										id,
										label: t(`chip.${id}`),
										onPress: () => setChip(id),
									}))}
									label={t(`chip.${chip}`)}
								/>
							</View>
						</View>
					) : null}
				</View>
			}
			onRefresh={reload}
			refreshing={false}
			renderItem={({ item }) => {
				const ref = { type: item.person.type, id: item.person.id };
				return (
					<PersonRow
						home={overview?.home ?? ""}
						onPress={() => (listDetail ? setSelected(ref) : openPerson(ref))}
						selected={
							listDetail &&
							selected !== null &&
							keyOf(selected) === item.person.key
						}
						summary={item}
					/>
				);
			}}
			renderSectionHeader={({ section }) => (
				<View style={{ backgroundColor: color.bg }}>
					<SectionHeader
						detail={String(section.people.length)}
						title={t(`group.${section.group}`)}
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
			{filters ? null : (
				<Stack.Screen
					options={{
						headerSearchBarOptions: {
							placeholder: t("search"),
							onChangeText: (event) => setQuery(event.nativeEvent.text),
						},
					}}
				/>
			)}
			<ListDetail
				detail={
					selected ? (
						<PersonView key={keyOf(selected)} person={selected} />
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
