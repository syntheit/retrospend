import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { NeedsCard } from "@/features/people/NeedsCard";
import { ReviewSheet } from "@/features/people/ReviewSheet";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { StaleNote } from "@/ui/List";
import { Menu } from "@/ui/Menu";
import { usePaneEnter } from "@/ui/motion";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { UnderlineTabs } from "@/ui/UnderlineTabs";
import {
	categoriesOf,
	filterExpenses,
	ME,
	type PaidBy,
	payers,
	projectNeeds,
} from "./filters";
import { ProjectExpenseDays } from "./ProjectExpenses";
import { ProjectHeader, ProjectTitle } from "./ProjectHeader";
import { ProjectPeopleTab } from "./ProjectPeopleTab";
import { ProjectSummaryTab } from "./ProjectSummaryTab";
import { SettleAllSheet } from "./SettleAllSheet";
import { useProject, useProjectSummary } from "./useProjects";

type Tab = "expenses" | "summary" | "people";
const TAB_ORDER: Tab[] = ["expenses", "summary", "people"];
type Period = "all" | "current";

/** Contributor or above may record payments, as on the web. */
const CAN_SETTLE = new Set(["ORGANIZER", "EDITOR", "CONTRIBUTOR"]);

/**
 * One project: who is in it, the tabs (Expenses, Summary, People), the group
 * total and your share, the budget, and what waits for you. Settle all is in
 * the Summary tab. A solo project has no People tab and no Settle all. A
 * screen on a phone, the detail pane of Projects on iPad and wide Android
 * windows.
 */
export function ProjectView({
	id,
	name,
	startSettling = false,
}: {
	id: string;
	/** The name the list knew, shown in the title while the page loads. */
	name?: string;
	startSettling?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const { listDetail } = useLayoutClass();
	const { space } = useTheme();
	const { state, reload } = useProject(id);
	const people = usePeopleOverview();
	const [tab, setTab] = useState<Tab>("expenses");
	const paneEnter = usePaneEnter(TAB_ORDER.indexOf(tab));
	const [period, setPeriod] = useState<Period>("all");
	const [toReview, setToReview] = useState(false);
	const [paidBy, setPaidBy] = useState<PaidBy>(null);
	const [category, setCategory] = useState<string | null>(null);
	const [reviewing, setReviewing] = useState<
		ReturnType<typeof projectNeeds>[number] | null
	>(null);
	const [settling, setSettling] = useState(startSettling);
	const page = state.status === "ready" ? state.data : null;
	const periodId = period === "current" ? (page?.openPeriod ?? null) : null;
	const summary = useProjectSummary(id, periodId, tab === "summary");
	const expenses = page?.expenses;
	const shown = useMemo(
		() =>
			expenses ? filterExpenses(expenses, { toReview, paidBy, category }) : [],
		[expenses, toReview, paidBy, category],
	);
	const needs = useMemo(
		() =>
			expenses && people.state.status === "ready"
				? projectNeeds(people.state.data.needs, expenses)
				: [],
		[expenses, people.state],
	);

	useEffect(() => {
		if (startSettling) setSettling(true);
	}, [startSettling]);

	if (state.status === "loading") {
		return (
			<Screen>
				{listDetail ? null : (
					<Stack.Screen
						options={{ title: name ?? "", headerLargeTitle: false }}
					/>
				)}
				<EmptyState title="" />
			</Screen>
		);
	}
	if (!page) {
		return (
			<Screen>
				{listDetail ? null : (
					<Stack.Screen
						options={{ title: name ?? "", headerLargeTitle: false }}
					/>
				)}
				<EmptyState detail={t("errorDetail")} title={t("errorOne")} />
			</Screen>
		);
	}

	const canSettle =
		!page.solo &&
		page.status === "ACTIVE" &&
		page.myRole !== null &&
		CAN_SETTLE.has(page.myRole);
	const tabs: { value: Tab; label: string }[] = [
		{ value: "expenses", label: t("tab.expenses") },
		{ value: "summary", label: t("tab.summary") },
		...(page.solo
			? []
			: [{ value: "people" as const, label: t("tab.people") }]),
	];
	const reviewCount = page.expenses.filter(
		(e) => e.waiting === "review",
	).length;
	const who = payers(page.expenses);
	const categories = categoriesOf(page.expenses);
	const whoLabel = (key: string) =>
		key === ME
			? t("you")
			: (page.expenses.find((e) => e.payerName === key)?.payerName ?? key);

	return (
		<Screen
			flush
			onRefresh={() => {
				reload();
				people.reload();
			}}
		>
			{listDetail ? null : (
				<Stack.Screen
					options={{
						title: page.name,
						headerLargeTitle: false,
						headerTitle: () => <ProjectTitle page={page} />,
					}}
				/>
			)}
			<StaleNote since={state.status === "ready" ? state.staleSince : null} />
			<ProjectHeader
				page={page}
				pane={listDetail}
				tabs={
					<UnderlineTabs
						accessibilityLabel={t("tabs")}
						onChange={setTab}
						tabs={tabs}
						value={tab}
					/>
				}
			/>

			<Animated.View entering={paneEnter} key={tab}>
				{tab === "expenses" ? (
					<>
						{needs.length > 0 ? (
							<View style={{ paddingTop: space[4] }}>
								<NeedsCard
									inline
									needs={needs}
									onPress={() => setReviewing(needs[0] ?? null)}
								/>
							</View>
						) : null}
						{reviewCount > 0 || who.length > 1 || categories.length > 1 ? (
							<ScrollView
								contentContainerStyle={{
									alignItems: "center",
									gap: space[2],
									paddingHorizontal: space[4],
									paddingTop: space[4],
								}}
								horizontal
								keyboardShouldPersistTaps="handled"
								showsHorizontalScrollIndicator={false}
							>
								{reviewCount > 0 ? (
									<Chip
										label={t("toReview", { count: reviewCount })}
										onPress={() => setToReview(!toReview)}
										selected={toReview}
									/>
								) : null}
								{who.length > 1 ? (
									<Menu
										active={paidBy !== null}
										chip
										items={[
											{
												id: "any",
												label: t("anyone"),
												onPress: () => setPaidBy(null),
											},
											...who.map((key) => ({
												id: key,
												label: whoLabel(key),
												onPress: () => setPaidBy(key),
											})),
										]}
										label={
											paidBy === null
												? t("paidBy")
												: t("paidByOne", { name: whoLabel(paidBy) })
										}
									/>
								) : null}
								{categories.length > 1 ? (
									<Menu
										active={category !== null}
										chip
										items={[
											{
												id: "all",
												label: t("allCategories"),
												onPress: () => setCategory(null),
											},
											...categories.map((c) => ({
												id: c.id,
												label: c.name,
												onPress: () => setCategory(c.id),
											})),
										]}
										label={
											categories.find((c) => c.id === category)?.name ??
											t("filter")
										}
									/>
								) : null}
							</ScrollView>
						) : null}
						{page.expenses.length === 0 ? (
							<EmptyState title={t("noExpenses")} />
						) : shown.length === 0 ? (
							<EmptyState title={t("noMatchExpenses")} />
						) : (
							<ProjectExpenseDays expenses={shown} solo={page.solo} />
						)}
						{page.expenseCount > page.expenses.length ? (
							<Text style={{ padding: space[4] }} tone="fg2" variant="small">
								{t("newestOnly", { count: page.expenses.length })}
							</Text>
						) : null}
					</>
				) : tab === "summary" ? (
					<>
						{page.openPeriod ? (
							<View
								style={{
									alignItems: "flex-start",
									paddingHorizontal: space[4],
									paddingTop: space[4],
								}}
							>
								<Menu
									active={period !== "all"}
									chip
									items={[
										{
											id: "all",
											label: t("period.all"),
											onPress: () => setPeriod("all"),
										},
										{
											id: "current",
											label: t("period.current"),
											onPress: () => setPeriod("current"),
										},
									]}
									label={t(`period.${period}`)}
								/>
							</View>
						) : null}
						<ProjectSummaryTab
							onSettleAll={canSettle ? () => setSettling(true) : undefined}
							state={summary.state}
						/>
					</>
				) : (
					<ProjectPeopleTab members={page.members} today={page.today} />
				)}
			</Animated.View>

			{reviewing ? (
				<ReviewSheet
					need={reviewing}
					onClose={() => setReviewing(null)}
					onDone={() => {
						reload();
						people.reload();
					}}
					person={reviewing.person}
					row={undefined}
					visible
				/>
			) : null}
			<SettleAllSheet
				members={page.members}
				onClose={() => setSettling(false)}
				onDone={() => {
					reload();
					summary.reload();
				}}
				projectId={page.id}
				projectName={page.name}
				visible={settling}
			/>
		</Screen>
	);
}
