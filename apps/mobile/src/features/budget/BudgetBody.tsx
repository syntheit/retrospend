import { router } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { SyncIssues } from "@/features/entry/SyncIssues";
import { ListRow, StaleNote } from "@/features/read/parts";
import { wealthHref } from "@/features/wealth/routes";
import { useTheme } from "@/theme";
import { BudgetHero } from "./BudgetHero";
import type { OpenSheet } from "./BudgetSheets";
import { DebtHero } from "./DebtHero";
import { ColumnTitles } from "./EnvelopeRow";
import { GroupSection } from "./GroupSection";
import { MonthBar } from "./MonthBar";
import { type MonthBounds, type MonthKind, monthDate } from "./months";
import { Notice, PlanSummary } from "./PlanSummary";
import { isLimits, overEnvelopes } from "./rows";
import { type BudgetMonth, envelopesOf, type PayoffProjection } from "./source";
import type { VerdictSheet } from "./verdict";

/**
 * The loaded Budget page: month switcher, hero and notice, the pool, then the
 * groups. On a wide screen (iPad, Android tablets) the hero and the pool sit
 * side by side and every row gets Assigned, Spent and Left columns.
 */
export function BudgetBody({
	data,
	kind,
	bounds,
	payoff,
	wide,
	stale,
	onSelectMonth,
	onOpen,
}: {
	data: BudgetMonth;
	kind: MonthKind;
	bounds: MonthBounds;
	/** Pay off debt books lead with the server's debt-free projection. */
	payoff: PayoffProjection | null;
	wide: boolean;
	stale: string | null;
	onSelectMonth: (month: number) => void;
	onOpen: (sheet: OpenSheet) => void;
}) {
	const t = useTranslations("mobile.budget");
	const format = useFormatter();
	const { color, space, type } = useTheme();
	const key = data.month.key;
	const closed = kind === "closed";
	const style = data.book.style;
	const over = overEnvelopes(data);
	const names = useMemo(
		() => new Map(envelopesOf(data).map((e) => [e.id, e.name] as const)),
		[data],
	);

	const openVerdict = (target: VerdictSheet) => {
		if (target === "usePlan") return onOpen({ kind: "usePlan" });
		if (target === "takeBack") return onOpen({ kind: "takeBack" });
		const first = over[0];
		if (first)
			onOpen({
				kind: "envelope",
				id: first.id,
				mode: target === "raiseLimit" ? "limit" : "cover",
			});
	};

	// Only the open month acts: a closed one is read-only, and planning the
	// next one is on the web for now (the sheets write the open month).
	const open = kind === "open";
	const note = (text: string) => (
		<Text
			style={{
				color: color.fg2,
				fontSize: type.body.size,
				paddingHorizontal: space[4],
				paddingTop: space[2],
			}}
		>
			{text}
		</Text>
	);
	const monthName = format.dateTime(monthDate(key), {
		month: "long",
		timeZone: "UTC",
	});
	const lead =
		style === "DEBT_PAYOFF" && !closed ? (
			<DebtHero data={data} payoff={payoff} />
		) : (
			<BudgetHero
				canAct={open}
				data={data}
				names={names}
				onAction={openVerdict}
			/>
		);
	const hero = closed ? (
		note(t("month.closed", { month: monthName }))
	) : (
		<>
			{lead}
			{kind === "next" ? note(t("month.planning", { month: monthName })) : null}
			<Notice
				canAct={open}
				data={data}
				onCover={() => openVerdict("cover")}
				onUsePlan={() => onOpen({ kind: "usePlan" })}
			/>
		</>
	);
	const summary = closed ? null : (
		<PlanSummary
			data={data}
			onUsePlan={
				kind === "open" && !isLimits(style)
					? () => onOpen({ kind: "usePlan" })
					: null
			}
		/>
	);

	return (
		<View>
			<StaleNote since={stale} />
			<SyncIssues padded />
			<MonthBar bounds={bounds} month={key} onChange={onSelectMonth} />
			{wide ? (
				<View
					style={{ flexDirection: "row", gap: space[6], paddingTop: space[2] }}
				>
					<View style={{ flex: 1 }}>{hero}</View>
					<View style={{ flex: 1 }}>{summary}</View>
				</View>
			) : (
				<>
					{hero}
					{summary}
				</>
			)}
			{wide ? <ColumnTitles style={style} /> : null}
			{data.groups
				.filter((group) => group.envelopes.length > 0)
				.map((group) => (
					<GroupSection
						group={group}
						key={group.id ?? "none"}
						onOpenEnvelope={(e) =>
							onOpen({ kind: "envelope", id: e.id, mode: "overview" })
						}
						style={style}
						wide={wide}
					/>
				))}
			<View style={{ paddingTop: space[4] }}>
				<ListRow
					accessibilityLabel={t("wealth")}
					onPress={() => router.push(wealthHref("budget"))}
				>
					<Text
						style={{ flex: 1, color: color.brand, fontSize: type.body.size }}
					>
						{t("wealth")}
					</Text>
				</ListRow>
				<Text
					style={{
						color: color.fg2,
						fontSize: type.small.size,
						padding: space[4],
					}}
				>
					{t("webForNow")}
				</Text>
			</View>
		</View>
	);
}
