import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useVerdictText } from "@/features/budget/useVerdictText";
import { verdictLabel, verdictSentence } from "@/features/budget/verdict";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { useHomeDates } from "./dates";
import { type Glance, heroOf, notPlannedOf } from "./source";

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
 * Home's one big card (home.html, phone A): Left to spend this month with a
 * day's allowance, a word when spending runs faster than planned, the spend
 * bar with a mark for today, and what was spent against what is not planned
 * yet. With no budget it leads with Spent this month. Over budget it reads
 * as the Budget page does: the verdict's label and sentence, never a minus.
 * Every number is the server's figure; the whole card opens Budget.
 */
export function HomeCard({ glance }: { glance: Glance }) {
	const t = useTranslations("mobile.home.card");
	const noRate = useTranslations("mobile.money")("noRate");
	const format = useMoneyText();
	const dates = useHomeDates();
	const verdictText = useVerdictText(NO_NAMES);
	const { color, radius, size, space } = useTheme();
	const hero = heroOf(glance);
	const budget = glance.budget?.state === "ready" ? glance.budget : null;
	const month = dates.month(glance.period.from);
	const opensBudget = hero.kind === "left" || hero.kind === "over";

	const label =
		hero.kind === "over"
			? verdictText(
					verdictLabel(hero.verdict, hero.verdict.style === "SAVE_FIRST"),
				)
			: hero.kind === "left"
				? t("leftIn", { month })
				: t("spentIn", { month });
	const unit =
		hero.kind === "left"
			? t("left")
			: hero.kind === "spent"
				? t("spent")
				: null;
	const sentence =
		hero.kind === "over"
			? verdictText(verdictSentence(hero.verdict))
			: hero.kind === "left"
				? t("perDay", { amount: format(hero.perDay), days: hero.daysLeft })
				: hero.lastToDate
					? t("lastMonth", { amount: format(hero.lastToDate) })
					: null;
	const faster =
		hero.kind === "left" &&
		(budget?.leftToSpend.fasterThanPlanned ||
			budget?.verdict.state === "FASTER_THAN_PLANNED");
	const shares = hero.kind === "left" ? barShares(glance) : null;
	const spentFoot =
		hero.kind === "left" && budget
			? t("spentThisMonth", { amount: format(budget.leftToSpend.spent) })
			: null;
	const pool = hero.kind === "left" ? notPlannedOf(glance) : null;
	const notPlanned = pool
		? t("notPlanned", { amount: format(pool.amount) })
		: null;

	const spoken = [
		label,
		hero.amount ? format(hero.amount) : noRate,
		unit,
		sentence,
		faster ? t("faster") : null,
		spentFoot,
		notPlanned,
	]
		.filter(Boolean)
		.join(", ");

	return (
		<Pressable
			accessibilityLabel={spoken}
			accessibilityRole={opensBudget ? "button" : undefined}
			accessible
			disabled={!opensBudget}
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
				{opensBudget ? (
					<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
				) : null}
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "baseline",
					gap: space[2],
					marginTop: space[1],
				}}
			>
				{hero.amount ? (
					<MoneyAmount align="left" size="hero" value={hero.amount} />
				) : (
					<Text variant="hero">{noRate}</Text>
				)}
				{unit ? <Text tone="fg2">{unit}</Text> : null}
			</View>
			{sentence ? (
				<Text tone="fg2" variant="small">
					{sentence}
				</Text>
			) : null}
			{faster ? (
				<View style={{ marginTop: space[1] }}>
					<StatusText label={t("faster")} tone="attention" />
				</View>
			) : null}
			{shares ? <SpendBar {...shares} /> : null}
			{spentFoot || notPlanned ? (
				<View
					style={{
						flexDirection: "row",
						justifyContent: "space-between",
						gap: space[3],
					}}
				>
					<Text style={{ flexShrink: 1 }} tone="fg3" variant="meta">
						{spentFoot ?? ""}
					</Text>
					{notPlanned ? (
						<Text
							style={{ flexShrink: 1, textAlign: "right" }}
							tone="fg3"
							variant="meta"
						>
							{notPlanned}
						</Text>
					) : null}
				</View>
			) : null}
			{glance.missingRates.length > 0 ? (
				<Text style={{ marginTop: space[1] }} tone="attention" variant="meta">
					{t("missingRates", { currencies: glance.missingRates.join(", ") })}
				</Text>
			) : null}
		</Pressable>
	);
}
