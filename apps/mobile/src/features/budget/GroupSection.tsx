import { formatPercent } from "@retrospend/domain/format-percent";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useFormatLocale } from "@/lib/intl";
import { useTheme } from "@/theme";
import { EnvelopeRow, useColumnWidth } from "./EnvelopeRow";
import { groupLeft, groupStartsOpen, isLimits } from "./rows";
import type { BudgetEnvelope, BudgetGroup, BudgetStyle } from "./source";
import { joinNames } from "./verdict";

/**
 * A group of envelopes under a header that carries the group's Left (and, on
 * a wide screen, Assigned and Spent). Flex and Save first fold each group to
 * one line; a tap opens it. Every figure is the group's own total from the
 * server.
 */
export function GroupSection({
	group,
	style,
	wide,
	onOpenEnvelope,
}: {
	group: BudgetGroup;
	style: BudgetStyle;
	wide: boolean;
	onOpenEnvelope: (envelope: BudgetEnvelope) => void;
}) {
	const t = useTranslations("mobile.budget.group");
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const column = useColumnWidth();
	const { color, size, space, type } = useTheme();
	const [open, setOpen] = useState(groupStartsOpen(style, group));
	const name = group.name ?? t(group.role ?? "ungrouped");
	const left = money(groupLeft(style, group));
	const locale = useFormatLocale();
	const count = t("count", { count: group.totals.count });
	// The envelopes over are named once here, without an amount: how far over is
	// each row's Left and the page's notice. A % target (50/30/20) leads with
	// what was planned and spent, the server's own basis points.
	const overNames = joinNames(
		group.envelopes.filter((e) => e.status === "OVERSPENT").map((e) => e.name),
		(head, last) => tb("listAnd", { head, last }),
	);
	const target = group.target;
	const percents =
		target?.kind === "PERCENT_OF_INCOME" &&
		!target.incomplete &&
		target.plannedBp != null &&
		target.spentBp != null
			? t("percents", {
					planned: formatPercent(target.plannedBp, { locale, digits: 0 }),
					spent: formatPercent(target.spentBp, { locale, digits: 0 }),
				})
			: null;
	const spoken = [
		name,
		percents,
		count,
		overNames ? t("overNames", { names: overNames }) : null,
		t("leftSpoken", { amount: left }),
	]
		.filter(Boolean)
		.join(", ");
	const cell = (value: string) => (
		<Text
			numberOfLines={1}
			style={{
				width: column,
				color: color.fg,
				fontSize: type.body.size,
				fontVariant: ["tabular-nums"],
				fontWeight: "600",
				textAlign: "right",
			}}
		>
			{value}
		</Text>
	);

	return (
		<View>
			<Pressable
				accessibilityHint={open ? t("collapse") : t("expand")}
				accessibilityLabel={spoken}
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={() => setOpen((v) => !v)}
				style={{
					minHeight: size.row.phone,
					flexDirection: "row",
					alignItems: "center",
					gap: space[3],
					paddingHorizontal: space[4],
					paddingTop: space[4],
					paddingBottom: space[1],
				}}
			>
				<View style={{ flex: 1, gap: space[1] }}>
					<Text
						accessibilityRole="header"
						numberOfLines={1}
						style={{
							color: color.fg,
							fontSize: type.section.size,
							fontWeight: "600",
						}}
					>
						{name}
					</Text>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{percents ? `${percents} · ` : ""}
						{count}
						{overNames ? (
							<Text style={{ color: color.attentionText }}>
								{` · ${t("overNames", { names: overNames })}`}
							</Text>
						) : null}
					</Text>
				</View>
				{wide ? (
					<>
						{cell(money(group.totals.assigned))}
						{cell(money(group.totals.spent))}
					</>
				) : null}
				{cell(left)}
			</Pressable>
			{open
				? group.envelopes.map((envelope) => (
						<EnvelopeRow
							envelope={envelope}
							key={envelope.id}
							limits={isLimits(style)}
							onPress={() => onOpenEnvelope(envelope)}
							wide={wide}
						/>
					))
				: null}
		</View>
	);
}
