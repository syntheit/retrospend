import { formatPercent } from "@retrospend/domain/format-percent";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useList } from "@/lib/list";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { ChipChevron } from "@/ui/Chip";
import type { GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Pill } from "@/ui/Pill";
import { ProgressBar } from "@/ui/ProgressBar";
import { Text } from "@/ui/Text";
import { EnvelopeRow, useColumnWidth } from "./EnvelopeRow";
import type { EnvelopeMode } from "./EnvelopeSheet";
import { envelopeSpentPercent } from "./envelopeLine";
import type { MonthKind } from "./months";
import {
	groupKey,
	groupLeft,
	groupPercents,
	groupStartsOpen,
	isLimits,
} from "./rows";
import type { BudgetEnvelope, BudgetGroup, BudgetStyle } from "./source";
import { useGroupName } from "./useGroupName";

type Open = (envelope: BudgetEnvelope, mode: EnvelopeMode) => void;

/** A neutral glyph for a folded group, by its role. */
function roleGlyph(role: BudgetGroup["role"]): GlyphName {
	switch (role) {
		case "BILLS":
			return "Receipt";
		case "SPENDING":
			return "ShoppingBag";
		case "SAVINGS":
			return "Landmark";
		default:
			return "Tag";
	}
}

/**
 * What a group says about itself, in words: the planned and spent shares of
 * a % target (50/30/20), the count, which envelopes are over, and its Left.
 * It is what a screen reader reads; the page shows the name and the Left.
 */
function useGroupSpoken() {
	const t = useTranslations("mobile.budget.group");
	const list = useList();
	const money = useMoneyText();
	const locale = useMoneyLocale();
	const name = useGroupName();
	return (group: BudgetGroup, style: BudgetStyle, open: boolean): string => {
		const overNames = list(
			group.envelopes
				.filter((e) => e.status === "OVERSPENT")
				.map((e) => e.name),
		);
		const share = groupPercents(group);
		return [
			name(group),
			share
				? t("percents", {
						planned: formatPercent(share.plannedBp, { locale, digits: 0 }),
						spent: formatPercent(share.spentBp, { locale, digits: 0 }),
					})
				: null,
			t("count", { count: group.totals.count }),
			overNames ? t("overNames", { names: overNames }) : null,
			t("leftSpoken", { amount: money(groupLeft(style, group)) }),
			open ? t("collapse") : t("expand"),
		]
			.filter(Boolean)
			.join(", ");
	};
}

/**
 * What a folded group says under its name: which envelopes are over (the
 * first two, with how far), else whether its bills are covered, else the
 * envelopes it holds. The server's own totals and rows, as the web words them.
 */
function useGroupLine() {
	const t = useTranslations("mobile.budget.group");
	const money = useMoneyText();
	const name = useGroupName();
	return (group: BudgetGroup): { text: string; attention: boolean } | null => {
		const over = group.envelopes.filter((e) => e.status === "OVERSPENT");
		if (over.length > 0) {
			return {
				text: over
					.slice(0, 2)
					.map((e) =>
						t("overBy", {
							name: e.name,
							amount: money(e.left, { sign: "never" }),
						}),
					)
					.join(" · "),
				attention: true,
			};
		}
		if (group.role === "BILLS") {
			return group.totals.need.minor > 0
				? {
						text: t("needed", {
							name: name(group),
							amount: money(group.totals.need),
						}),
						attention: true,
					}
				: { text: t("covered", { name: name(group) }), attention: false };
		}
		const names = group.envelopes.map((e) => e.name).join(", ");
		return names ? { text: names, attention: false } : null;
	};
}

/** The money at the end of a group: its Left, or the "Over by" pill, or the wide columns. */
function useGroupEnd() {
	const t = useTranslations("mobile.budget.row");
	const money = useMoneyText();
	const column = useColumnWidth();
	return (group: BudgetGroup, style: BudgetStyle, wide: boolean) => {
		const left = groupLeft(style, group);
		const over = isLimits(style)
			? left.minor < 0
				? left
				: null
			: group.totals.over.minor > 0
				? group.totals.over
				: null;
		if (wide) {
			const cell = (value: string) => (
				<Text
					numberOfLines={1}
					style={{ width: column, textAlign: "right" }}
					tabular
					tone="fg3"
					weight="medium"
				>
					{value}
				</Text>
			);
			return {
				over,
				node: (
					<>
						{cell(money(group.totals.assigned))}
						{cell(money(group.totals.spent))}
						{cell(money(left))}
					</>
				),
			};
		}
		return {
			over,
			node: over ? (
				<Pill text={t("overBy", { amount: money(over, { sign: "never" }) })} />
			) : (
				<MoneyAmount
					tone={left.minor === 0 ? "muted" : "default"}
					value={left}
				/>
			),
		};
	};
}

/**
 * A group that starts open (Every dollar, Limits, a weekly book's Spending):
 * its name at 13/600 fg-2 and its Left at 500 fg-3 over a list of its
 * envelopes. A tap on the header folds it.
 */
function GroupBlock({
	group,
	style,
	kind,
	wide,
	open,
	onToggle,
	onOpenEnvelope,
}: {
	group: BudgetGroup;
	style: BudgetStyle;
	kind: MonthKind;
	wide: boolean;
	open: boolean;
	onToggle: () => void;
	onOpenEnvelope: Open;
}) {
	const money = useMoneyText();
	const name = useGroupName();
	const spoken = useGroupSpoken();
	const { color, size, space } = useTheme();
	const left = money(groupLeft(style, group));
	return (
		<View>
			<Pressable
				accessibilityLabel={spoken(group, style, open)}
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={onToggle}
				style={{
					minHeight: size.touchMin.phone,
					flexDirection: "row",
					alignItems: "flex-end",
					justifyContent: "space-between",
					gap: space[3],
					paddingHorizontal: size.gutter.phone + space[1],
					paddingBottom: space[2],
					paddingTop: space[4],
				}}
			>
				<View
					style={{
						flex: 1,
						flexDirection: "row",
						alignItems: "center",
						gap: space[1],
					}}
				>
					<Text numberOfLines={1} tone="fg2" variant="small" weight="semibold">
						{name(group)}
					</Text>
					<View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
						<ChipChevron color={color.fg3} />
					</View>
				</View>
				{wide ? null : (
					<Text
						numberOfLines={1}
						tabular
						tone="fg3"
						variant="small"
						weight="medium"
					>
						{left}
					</Text>
				)}
			</Pressable>
			{open ? (
				<ListGroup>
					{group.envelopes.map((envelope) => (
						<EnvelopeRow
							envelope={envelope}
							key={envelope.id}
							kind={kind}
							onOpen={(mode) => onOpenEnvelope(envelope, mode)}
							style={style}
							wide={wide}
						/>
					))}
				</ListGroup>
			) : null}
		</View>
	);
}

/**
 * A folded group (Flex, Save first, a weekly book's Bills and Savings): one
 * row with its tile, a bar of what it spent, one line of words and its Left
 * or the "Over by" pill. A tap opens the envelopes under it.
 */
function BucketRows({
	group,
	style,
	kind,
	wide,
	open,
	onToggle,
	onOpenEnvelope,
}: {
	group: BudgetGroup;
	style: BudgetStyle;
	kind: MonthKind;
	wide: boolean;
	open: boolean;
	onToggle: () => void;
	onOpenEnvelope: Open;
}) {
	const name = useGroupName();
	const spoken = useGroupSpoken();
	const line = useGroupLine();
	const end = useGroupEnd();
	const { color, space } = useTheme();
	const words = line(group);
	const { over, node } = end(group, style, wide);
	const percent =
		group.role === "SAVINGS" ? null : envelopeSpentPercent(group.totals);
	return (
		<>
			<ListRow
				accessibilityLabel={spoken(group, style, open)}
				end={node}
				lead={<IconTile name={roleGlyph(group.role)} />}
				onPress={onToggle}
				sub={
					<View style={{ gap: space[1], paddingTop: space[1] }}>
						{percent !== null ? (
							<ProgressBar over={over !== null} percent={percent} />
						) : null}
						{words ? (
							<Text
								numberOfLines={1}
								style={{
									color: words.attention ? color.attentionText : color.fg3,
								}}
								variant="meta"
							>
								{words.text}
							</Text>
						) : null}
					</View>
				}
				title={
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[1],
						}}
					>
						<Text numberOfLines={1} weight="medium">
							{name(group)}
						</Text>
						<View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
							<ChipChevron color={color.fg3} />
						</View>
					</View>
				}
			/>
			{open
				? group.envelopes.map((envelope) => (
						<View key={envelope.id}>
							<View style={{ height: 1, backgroundColor: color.line }} />
							<View style={{ paddingLeft: space[6] }}>
								<EnvelopeRow
									envelope={envelope}
									kind={kind}
									onOpen={(mode) => onOpenEnvelope(envelope, mode)}
									style={style}
									wide={wide}
								/>
							</View>
						</View>
					))
				: null}
		</>
	);
}

type Run =
	| { folded: true; groups: BudgetGroup[] }
	| { folded: false; group: BudgetGroup };

/** Folded groups that follow one another share one list; an open group stands alone. */
function runsOf(groups: BudgetGroup[], style: BudgetStyle): Run[] {
	const runs: Run[] = [];
	for (const group of groups) {
		if (groupStartsOpen(style, group)) {
			runs.push({ folded: false, group });
			continue;
		}
		const last = runs[runs.length - 1];
		if (last?.folded) last.groups.push(group);
		else runs.push({ folded: true, groups: [group] });
	}
	return runs;
}

/**
 * The groups of the month. Each one starts open or folded as the book style
 * says (SPEC 6.1) and the person can flip it; every figure is the group's
 * own total from the server.
 */
export function GroupList({
	groups,
	style,
	kind,
	wide,
	onOpenEnvelope,
}: {
	groups: BudgetGroup[];
	style: BudgetStyle;
	kind: MonthKind;
	wide: boolean;
	onOpenEnvelope: Open;
}) {
	const { space } = useTheme();
	const [flipped, setFlipped] = useState<Record<string, boolean>>({});
	const isOpen = (group: BudgetGroup) =>
		flipped[groupKey(group)] ?? groupStartsOpen(style, group);
	const flip = (group: BudgetGroup) =>
		setFlipped((state) => ({ ...state, [groupKey(group)]: !isOpen(group) }));
	return (
		<>
			{runsOf(groups, style).map((run) =>
				run.folded ? (
					<View
						key={run.groups.map(groupKey).join("+")}
						style={{ paddingTop: space[4] }}
					>
						<ListGroup>
							{run.groups.map((group) => (
								<BucketRows
									group={group}
									key={groupKey(group)}
									kind={kind}
									onOpenEnvelope={onOpenEnvelope}
									onToggle={() => flip(group)}
									open={isOpen(group)}
									style={style}
									wide={wide}
								/>
							))}
						</ListGroup>
					</View>
				) : (
					<GroupBlock
						group={run.group}
						key={groupKey(run.group)}
						kind={kind}
						onOpenEnvelope={onOpenEnvelope}
						onToggle={() => flip(run.group)}
						open={isOpen(run.group)}
						style={style}
						wide={wide}
					/>
				),
			)}
		</>
	);
}
