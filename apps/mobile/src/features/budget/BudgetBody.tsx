import { useMemo } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { SyncIssues } from "@/features/entry/SyncIssues";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { StaleNote } from "@/ui/List";
import { Text } from "@/ui/Text";
import { BudgetHero } from "./BudgetHero";
import { BudgetNotice } from "./BudgetNotice";
import type { OpenSheet } from "./BudgetSheets";
import { DebtHero } from "./DebtHero";
import { ColumnTitles } from "./EnvelopeRow";
import { GroupList } from "./GroupSection";
import { MonthBar } from "./MonthBar";
import { type MonthBounds, type MonthKind, monthDate } from "./months";
import { PlanSummary } from "./PlanSummary";
import { isLimits, overEnvelopes } from "./rows";
import { type BudgetMonth, envelopesOf, type PayoffProjection } from "./source";
import type { VerdictSheet } from "./verdict";

/**
 * The loaded Budget page: month menu, hero and notice, the pool and who owes
 * you, then the groups. On a wide screen (iPad, Android tablets) the hero and
 * the pool sit side by side and every row gets Assigned, Spent and Left
 * columns.
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
	const { size, space } = useTheme();
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

	// Only the open month acts: a closed one is read-only, and the next one is
	// planned in drafts (Plan the month in the menu), not assigned.
	const open = kind === "open";
	const note = (text: string) => (
		<Text
			style={{ paddingHorizontal: size.gutter.phone, paddingTop: space[2] }}
			tone="fg2"
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
				canAfford={!closed}
				data={data}
				names={names}
				onAction={openVerdict}
				onAfford={() => onOpen({ kind: "afford" })}
			/>
		);
	const hero = closed ? (
		note(t("month.closed", { month: monthName }))
	) : (
		<>
			{lead}
			{kind === "next" ? note(t("month.planning", { month: monthName })) : null}
			<BudgetNotice
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
			onOpenOwed={open ? () => onOpen({ kind: "owed" }) : null}
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
			<GroupList
				groups={data.groups.filter((group) => group.envelopes.length > 0)}
				kind={kind}
				onOpenEnvelope={(e, mode) =>
					onOpen({ kind: "envelope", id: e.id, mode })
				}
				style={style}
				wide={wide}
			/>
			{open ? (
				<View
					style={{
						alignItems: "flex-start",
						paddingHorizontal: size.gutter.phone,
						paddingTop: space[4],
					}}
				>
					<Button
						label={t("manage.newEnvelope")}
						onPress={() => onOpen({ kind: "newEnvelope" })}
						variant="outlined"
					/>
				</View>
			) : null}
		</View>
	);
}
