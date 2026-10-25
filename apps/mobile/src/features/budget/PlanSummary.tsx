import { router } from "expo-router";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { overEnvelopes } from "./rows";
import type { BudgetMonth } from "./source";

/** A label with its figure at the end, as a row (a tap is optional). */
function SummaryRow({
	label,
	detail,
	value,
	spoken,
	onPress,
}: {
	label: string;
	detail?: string;
	value: string;
	spoken: string;
	onPress?: () => void;
}) {
	const { color, space, type } = useTheme();
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress}>
			<View style={{ flex: 1, gap: space[1] }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{label}
				</Text>
				{detail ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{detail}
					</Text>
				) : null}
			</View>
			<Text
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					fontWeight: "500",
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</ListRow>
	);
}

/**
 * The pool (Not planned yet, or To assign) and what people owe you. Limits
 * books have no pool: nothing there is assigned (SPEC 6.1). Every figure is
 * the month's own.
 */
export function PlanSummary({
	data,
	onUsePlan,
}: {
	data: BudgetMonth;
	/** Set when Use my plan can run here: an open month with money to plan. */
	onUsePlan: (() => void) | null;
}) {
	const t = useTranslations("mobile.budget");
	const money = useMoneyText();
	const pool = t(`pool.${data.toAssign.poolName}`);
	const owed = data.owed;
	const poolText = money(data.toAssign.amount);
	return (
		<View>
			{/* The pool is said once: by the hero (To assign leads) or by the notice. */}
			{data.book.style === "LIMITS" ||
			data.verdict.lead.kind === "TO_ASSIGN" ||
			data.verdict.notice?.kind === "NOT_PLANNED_YET" ? null : (
				<SummaryRow
					label={pool}
					onPress={
						onUsePlan && data.toAssign.amount.minor > 0 ? onUsePlan : undefined
					}
					spoken={`${pool}, ${poolText}`}
					value={poolText}
				/>
			)}
			{owed.people > 0 ? (
				<SummaryRow
					detail={t("owed.people", { count: owed.people })}
					label={t("owed.title")}
					onPress={() =>
						router.navigate({
							pathname: "/people",
							params: { segment: "people" },
						})
					}
					spoken={`${t("owed.title")}, ${t("owed.people", { count: owed.people })}, ${money(owed.held)}`}
					value={money(owed.held)}
				/>
			) : null}
		</View>
	);
}

/**
 * At most one notice under the hero, and only when its button differs from
 * the hero's own (a fact appears once). The words and the numbers are the
 * verdict's.
 */
export function Notice({
	data,
	canAct,
	onUsePlan,
	onCover,
}: {
	data: BudgetMonth;
	canAct: boolean;
	onUsePlan: () => void;
	onCover: () => void;
}) {
	const t = useTranslations("mobile.budget.notice");
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const notice = data.verdict.notice;
	if (!notice || notice.action === data.verdict.action) return null;
	const over = overEnvelopes(data);
	const text =
		notice.kind === "NOT_PLANNED_YET"
			? t("notPlanned", { amount: money(notice.amount) })
			: t("overspent", {
					count: over.length,
					name: over.length === 1 ? (over[0]?.name ?? "") : "",
					amount: money(notice.amount, { sign: "never" }),
				});
	const action =
		canAct && notice.action === "USE_PLAN"
			? { label: t("usePlan"), run: onUsePlan }
			: canAct && notice.action === "COVER"
				? { label: t("cover"), run: onCover }
				: null;
	return (
		<View
			style={{
				gap: space[2],
				paddingHorizontal: space[4],
				paddingTop: space[4],
				alignItems: "flex-start",
			}}
		>
			<Text
				accessibilityRole="alert"
				style={{ color: color.attentionText, fontSize: type.body.size }}
			>
				{text}
			</Text>
			{action ? (
				<Button label={action.label} onPress={action.run} variant="outlined" />
			) : null}
		</View>
	);
}
