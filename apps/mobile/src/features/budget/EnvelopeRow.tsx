import { categoryTone } from "@retrospend/domain/category-tone";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { CategoryTile, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Pill } from "@/ui/Pill";
import { ProgressBar } from "@/ui/ProgressBar";
import { RowMenu } from "@/ui/RowMenu";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import type { MenuItem } from "@/ui/types";
import type { EnvelopeMode } from "./EnvelopeSheet";
import { envelopeSpentPercent, leftAtom } from "./envelopeLine";
import type { MonthKind } from "./months";
import { envelopeActions, isLimits } from "./rows";
import type { BudgetEnvelope, BudgetStyle } from "./source";
import { useTargetText } from "./useTargetText";

/** The width of one money column on a wide screen, from the spacing scale. */
export function useColumnWidth(): number {
	const { space } = useTheme();
	return space[12] * 2 + space[4];
}

/** The envelope's open sheet modes a swipe or the long-press menu can start. */
function useEnvelopeMenu(
	e: BudgetEnvelope,
	style: BudgetStyle,
	kind: MonthKind,
	onOpen: (mode: EnvelopeMode) => void,
) {
	const t = useTranslations("mobile.budget.envelope");
	const tr = useTranslations("mobile.budget.row");
	const can = envelopeActions(e, style, kind);
	const limits = isLimits(style);
	const target = kind !== "closed" && !limits;
	const menu: MenuItem[] = [];
	const add = (id: string, label: string, mode: EnvelopeMode) =>
		menu.push({ id, label, onPress: () => onOpen(mode) });
	if (can.cover) add("cover", t("cover"), "cover");
	if (can.limit) add("limit", t("limitAction"), "limit");
	if (can.assign) add("assign", t("assign"), "assign");
	if (can.move) add("move", t("move"), "move");
	if (target) add("target", t("targetAction"), "target");
	const lead = can.cover
		? { label: t("cover"), mode: "cover" as const }
		: can.move
			? { label: tr("swipeMove"), mode: "move" as const }
			: can.limit
				? { label: tr("swipeLimit"), mode: "limit" as const }
				: null;
	return {
		menu,
		leading: lead
			? {
					label: lead.label,
					onPress: () => onOpen(lead.mode),
					tone: "brand" as const,
				}
			: undefined,
		trailing: target
			? {
					label: tr("swipeTarget"),
					onPress: () => onOpen("target"),
					tone: "neutral" as const,
				}
			: undefined,
	};
}

/**
 * One envelope: its category tile, name, a bar of what it spent, the target
 * sentence and, at the end, its Left (a plain amount, quiet at zero) or a
 * "Over by" pill, with "more needed" under a short one. Phones show Left
 * only; a wide screen adds the Assigned (or Limit) and Spent columns. On iOS
 * a swipe starts Move or Cover and Target; both platforms have the same
 * actions in the long-press menu.
 */
export function EnvelopeRow({
	envelope,
	style,
	kind,
	wide,
	onOpen,
}: {
	envelope: BudgetEnvelope;
	style: BudgetStyle;
	kind: MonthKind;
	wide: boolean;
	/** `overview` is a tap; the others start that form. */
	onOpen: (mode: EnvelopeMode) => void;
}) {
	const t = useTranslations("mobile.budget.row");
	const money = useMoneyText();
	const targetText = useTargetText();
	const column = useColumnWidth();
	const { color, space } = useTheme();
	const limits = isLimits(style);
	const line = targetText(envelope, limits);
	const atom = leftAtom(envelope);
	const left = money(envelope.left);
	const over = envelope.status === "OVERSPENT";
	const percent = envelopeSpentPercent(envelope);
	const { menu, leading, trailing } = useEnvelopeMenu(
		envelope,
		style,
		kind,
		onOpen,
	);
	const spoken = [
		envelope.name,
		line?.text,
		atom.kind === "over"
			? t("overBy", { amount: money(atom.amount, { sign: "never" }) })
			: wide
				? t(limits ? "wideSpokenLimit" : "wideSpoken", {
						assigned: money(envelope.assigned),
						spent: money(envelope.spent),
						left,
					})
				: t("leftSpoken", { amount: left }),
		atom.kind === "needed"
			? t("moreNeeded", { amount: money(atom.need) })
			: null,
	]
		.filter(Boolean)
		.join(", ");

	const cell = (value: string, strong?: boolean) => (
		<Text
			numberOfLines={1}
			style={{ width: column, textAlign: "right" }}
			tabular
			tone={strong && over ? "attention" : "fg"}
			weight={strong ? "medium" : "normal"}
		>
			{value}
		</Text>
	);

	let end: ReactNode;
	if (wide) {
		end = (
			<>
				{cell(money(envelope.assigned))}
				{cell(money(envelope.spent))}
				{cell(left, true)}
			</>
		);
	} else if (atom.kind === "over") {
		end = (
			<Pill
				text={t("overBy", { amount: money(atom.amount, { sign: "never" }) })}
			/>
		);
	} else {
		end = (
			<View style={{ alignItems: "flex-end", gap: space[1] }}>
				<MoneyAmount
					tone={atom.kind === "plain" && atom.zero ? "muted" : "default"}
					value={atom.left}
				/>
				{atom.kind === "needed" ? (
					<Text numberOfLines={1} tone="fg3" variant="meta">
						{t("moreNeeded", { amount: money(atom.need) })}
					</Text>
				) : null}
			</View>
		);
	}

	const row = (onPress?: () => void) => (
		<ListRow
			accessibilityLabel={spoken}
			end={end}
			lead={
				<CategoryTile
					category={{
						name: envelope.name,
						icon: envelope.icon,
						tone: categoryTone(envelope.color ?? ""),
					}}
				/>
			}
			onPress={onPress}
			sub={
				<View style={{ gap: space[1], paddingTop: space[1] }}>
					{percent !== null ? (
						<ProgressBar over={over} percent={percent} />
					) : null}
					{line ? (
						<Text
							numberOfLines={1}
							style={{
								color: line.attention ? color.attentionText : color.fg3,
							}}
							variant="meta"
						>
							{line.text}
						</Text>
					) : null}
				</View>
			}
			title={envelope.name}
		/>
	);
	const open = () => onOpen("overview");
	// Nothing to swipe or hold (a closed month): the row is the tap alone.
	if (menu.length === 0) return row(open);
	return Platform.OS === "ios" ? (
		<SwipeRow
			leading={leading}
			menu={menu}
			menuTitle={envelope.name}
			onPress={open}
			trailing={trailing}
		>
			{row()}
		</SwipeRow>
	) : (
		<RowMenu items={menu} onPress={open} title={envelope.name}>
			{row()}
		</RowMenu>
	);
}

/** The column titles of a wide table: Assigned (Limit in Limits), Spent, Left. */
export function ColumnTitles({ style }: { style: BudgetStyle }) {
	const t = useTranslations("mobile.budget.column");
	const column = useColumnWidth();
	const { space } = useTheme();
	const title = (text: string) => (
		<Text
			style={{ width: column, textAlign: "right" }}
			tone="fg2"
			variant="small"
		>
			{text}
		</Text>
	);
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				flexDirection: "row",
				paddingHorizontal: space[4],
				paddingTop: space[4],
				gap: space[3],
			}}
		>
			<View style={{ flex: 1 }} />
			{title(isLimits(style) ? t("limit") : t("assigned"))}
			{title(t("spent"))}
			{title(t("left"))}
		</View>
	);
}
