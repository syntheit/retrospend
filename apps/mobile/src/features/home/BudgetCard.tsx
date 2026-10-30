import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useVerdictText } from "@/features/budget/useVerdictText";
import { verdictLabel, verdictSentence } from "@/features/budget/verdict";
import { MoneyAmount } from "@/ui/Money";

import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { useHomeDates } from "./dates";
import { budgetStatusOf, type Glance } from "./source";

/** Home names no envelopes: the over verdicts it words never list any. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The share of the plan spent and of the month gone, as bar geometry only
 * (no figure is shown from these). A plan of nothing has no bar.
 */
function barShares(glance: Glance): { spent: number; time: number } | null {
	const budget = glance.budget;
	if (budget?.state !== "ready") return null;
	const { assigned, spent } = budget.leftToSpend;
	if (assigned.minor <= 0) return null;
	return {
		spent: Math.min(1, Math.max(0, spent.minor / assigned.minor)),
		time: Math.min(1, Math.max(0, glance.period.day / glance.period.days)),
	};
}

/** The spend bar: the spent share filled in accent, a 2pt mark for today. */
function SpendBar({ spent, time }: { spent: number; time: number }) {
	const { color, radius, space } = useTheme();
	const mark = space[1] / 2;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				height: space[2],
				marginVertical: space[3],
				borderRadius: radius.chip,
				backgroundColor: color.raised,
			}}
		>
			<View
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					bottom: 0,
					width: `${spent * 100}%`,
					borderRadius: radius.chip,
					backgroundColor: color.accent,
				}}
			/>
			<View
				style={{
					position: "absolute",
					left: `${time * 100}%`,
					top: -space[1] / 2,
					bottom: -space[1] / 2,
					width: mark,
					marginLeft: -mark / 2,
					borderRadius: mark / 2,
					backgroundColor: color.fg,
				}}
			/>
		</View>
	);
}

/**
 * Home's budget card, its own part under the hero: Left to spend this month
 * with a day's allowance, a word when spending runs faster than planned and
 * the spend bar with a mark for today. What was spent is the hero above it and
 * what is not planned yet is a tile, so neither is said again here. Over budget it reads as the Budget page does: the verdict's
 * label and sentence, never a minus. Nothing without a ready budget. Every
 * number is the server's figure; the whole card opens Budget.
 */
export function BudgetCard({ glance }: { glance: Glance }) {
	const t = useTranslations("mobile.home.card");
	const format = useMoneyText();
	const dates = useHomeDates();
	const verdictText = useVerdictText(NO_NAMES);
	const { color, radius, size, space } = useTheme();
	const status = budgetStatusOf(glance);
	const budget = glance.budget?.state === "ready" ? glance.budget : null;
	if (!status) return null;
	const month = dates.month(glance.period.from);

	const label =
		status.kind === "over"
			? verdictText(
					verdictLabel(status.verdict, status.verdict.style === "SAVE_FIRST"),
				)
			: t("leftIn", { month });
	const unit = status.kind === "left" ? t("left") : null;
	const sentence =
		status.kind === "over"
			? verdictText(verdictSentence(status.verdict))
			: t("perDay", { amount: format(status.perDay), days: status.daysLeft });
	const faster =
		status.kind === "left" &&
		(budget?.leftToSpend.fasterThanPlanned ||
			budget?.verdict.state === "FASTER_THAN_PLANNED");
	const shares = status.kind === "left" ? barShares(glance) : null;
	const spoken = [
		label,
		format(status.amount),
		unit,
		sentence,
		faster ? t("faster") : null,
	]
		.filter(Boolean)
		.join(", ");

	return (
		<Pressable
			accessibilityLabel={spoken}
			accessibilityRole="button"
			accessible
			onPress={() => router.navigate("/budget")}
			style={({ pressed }) => ({
				padding: space[4],
				gap: space[1],
				backgroundColor: pressed ? color.raised : color.surface,
				borderWidth: 1,
				borderColor: color.line,
				borderRadius: radius.panel,
			})}
		>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				<Glyph color={color.fg2} name="Wallet" size={size.icon.phone} />
				<Text numberOfLines={1} style={{ flex: 1 }} tone="fg2" variant="small">
					{label}
				</Text>
				<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "baseline",
					gap: space[2],
					marginTop: space[1],
				}}
			>
				<MoneyAmount align="left" size="section" strong value={status.amount} />
				{unit ? <Text tone="fg2">{unit}</Text> : null}
			</View>
			<Text tone="fg2" variant="small">
				{sentence}
			</Text>
			{faster ? (
				<View style={{ marginTop: space[1] }}>
					<StatusText label={t("faster")} tone="attention" />
				</View>
			) : null}
			{shares ? <SpendBar {...shares} /> : null}
		</Pressable>
	);
}
