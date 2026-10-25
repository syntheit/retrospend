import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { SectionHeader, StaleNote } from "@/features/read/parts";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Cover } from "./Cover";
import { useDayRange } from "./dates";
import { ProjectExpenseRow } from "./ProjectExpenses";
import { ProjectPeopleTab } from "./ProjectPeopleTab";
import { BudgetLine } from "./ProjectRow";
import { ProjectSummaryTab } from "./ProjectSummaryTab";
import { SettleAllSheet } from "./SettleAllSheet";
import type { ProjectPage } from "./source";
import { useProject, useProjectSummary } from "./useProjects";

type Tab = "expenses" | "summary" | "people";
type Period = "all" | "current";

/** Contributor or above may record payments, as on the web. */
const CAN_SETTLE = new Set(["ORGANIZER", "EDITOR", "CONTRIBUTOR"]);

/** Money lines of one kind (total, your share), the first one large. */
function Totals({
	label,
	lines,
	hero,
}: {
	label: string;
	lines: ProjectPage["total"];
	hero?: boolean;
}) {
	const { color, space, type } = useTheme();
	if (lines.length === 0) return null;
	return (
		<View style={{ gap: space[1] }}>
			<Text style={{ color: color.fg2, fontSize: type.body.size }}>
				{label}
			</Text>
			{lines.map((line, index) => (
				<MoneyAmount
					align="left"
					key={line.currency}
					size={hero && index === 0 ? "hero" : "body"}
					value={line}
				/>
			))}
		</View>
	);
}

/**
 * One project: who is in it, the group total and your share, the budget,
 * Settle all, and three tabs (Expenses, Summary, People). A solo project has
 * no People tab and no Settle all. A screen on a phone, the detail pane of
 * Projects on iPad and wide Android windows.
 */
export function ProjectView({
	id,
	startSettling = false,
}: {
	id: string;
	startSettling?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const faces = useFaces();
	const range = useDayRange();
	const { connection } = useServerConnection();
	const { color, size, space, type } = useTheme();
	const { listDetail } = useLayoutClass();
	const { state, reload } = useProject(id);
	const [tab, setTab] = useState<Tab>("expenses");
	const [period, setPeriod] = useState<Period>("all");
	const [settling, setSettling] = useState(startSettling);
	const page = state.status === "ready" ? state.data : null;
	const periodId = period === "current" ? (page?.openPeriod ?? null) : null;
	const summary = useProjectSummary(id, periodId, tab === "summary");

	useEffect(() => {
		if (startSettling) setSettling(true);
	}, [startSettling]);

	if (state.status === "loading") {
		return (
			<Screen>
				<EmptyState title="" />
			</Screen>
		);
	}
	if (!page) {
		return (
			<Screen>
				<EmptyState detail={t("errorDetail")} title={t("errorOne")} />
			</Screen>
		);
	}

	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const others = page.members.filter((m) => !m.isMe && m.leftOn === null);
	const when = range(page.firstExpense, page.lastExpense, page.today);
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

	return (
		<Screen flush>
			{listDetail ? null : (
				<Stack.Screen options={{ title: page.name, headerLargeTitle: false }} />
			)}
			<StaleNote since={state.status === "ready" ? state.staleSince : null} />
			<View style={{ gap: space[3], padding: space[4] }}>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
				>
					<Cover
						diameter={size.avatar.lg}
						id={page.id}
						imageUri={absoluteImage(page.imageUrl, baseUrl)}
						name={page.name}
					/>
					<View style={{ flex: 1, gap: 2 }}>
						<Text
							accessibilityRole="header"
							style={{
								color: color.fg,
								fontSize: type.title.size,
								fontWeight: "600",
							}}
						>
							{page.name}
						</Text>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{[
								page.status === "ARCHIVED" ? t("archived") : null,
								when,
								t("expenseCount", { count: page.expenseCount }),
							]
								.filter(Boolean)
								.join(" · ")}
						</Text>
					</View>
				</View>
				{page.solo ? null : (
					<View
						accessibilityLabel={others.map((m) => m.name).join(", ")}
						accessible
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<AvatarStack
							faces={faces(
								others.map((m) => ({
									key: m.id,
									name: m.name,
									imageUrl: m.imageUrl,
								})),
							)}
							max={6}
							size="md"
						/>
						<Text
							numberOfLines={1}
							style={{
								flex: 1,
								color: color.fg2,
								fontSize: type.body.size,
							}}
						>
							{others.map((m) => m.name.split(/\s+/)[0]).join(", ")}
						</Text>
					</View>
				)}
				<Totals
					hero
					label={page.solo ? t("spent") : t("groupTotal")}
					lines={page.total}
				/>
				{page.solo ? null : (
					<Totals label={t("yourShareLabel")} lines={page.myShare} />
				)}
				{page.budget ? <BudgetLine budget={page.budget} /> : null}
				{canSettle ? (
					<View style={{ alignItems: "flex-start" }}>
						<Button
							label={t("settleAll.open")}
							onPress={() => setSettling(true)}
						/>
					</View>
				) : null}
			</View>

			<View style={{ paddingHorizontal: space[4], gap: space[3] }}>
				<Segmented
					accessibilityLabel={t("tabs")}
					onChange={setTab}
					options={tabs}
					value={tab}
				/>
				{tab === "summary" && page.openPeriod ? (
					<Segmented
						accessibilityLabel={t("period.label")}
						onChange={setPeriod}
						options={[
							{ value: "all", label: t("period.all") },
							{ value: "current", label: t("period.current") },
						]}
						value={period}
					/>
				) : null}
			</View>

			{tab === "expenses" ? (
				page.expenses.length === 0 ? (
					<EmptyState title={t("noExpenses")} />
				) : (
					<>
						<SectionHeader
							detail={String(page.expenseCount)}
							title={t("expenses")}
						/>
						{page.expenses.map((expense) => (
							<ProjectExpenseRow expense={expense} key={expense.id} />
						))}
						{page.expenseCount > page.expenses.length ? (
							<Text
								style={{
									color: color.fg2,
									fontSize: type.small.size,
									padding: space[4],
								}}
							>
								{t("newestOnly", { count: page.expenses.length })}
							</Text>
						) : null}
					</>
				)
			) : tab === "summary" ? (
				<ProjectSummaryTab state={summary.state} />
			) : (
				<ProjectPeopleTab members={page.members} today={page.today} />
			)}

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
