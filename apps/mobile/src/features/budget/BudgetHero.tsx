import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import type { BudgetMonth } from "./source";
import { useVerdictText } from "./useVerdictText";
import {
	verdictActionKey,
	verdictIsOver,
	verdictLabel,
	verdictSentence,
	verdictSheet,
	type VerdictSheet,
} from "./verdict";

/**
 * The one hero of the page: one number, one sentence, at most one button. The
 * server picks the state and carries every figure (the verdict); this words
 * it. A figure the server could not work out (a missing rate) reads as words,
 * never as 0.
 */
export function BudgetHero({
	data,
	names,
	canAct,
	onAction,
}: {
	data: BudgetMonth;
	names: ReadonlyMap<string, string>;
	/** False in a closed month: nothing there can change. */
	canAct: boolean;
	onAction: (sheet: VerdictSheet) => void;
}) {
	const t = useTranslations("mobile.budget");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const text = useVerdictText(names);
	const { color, space, type } = useTheme();
	const v = data.verdict;
	const missing = data.missingRates.map((r) => r.currency).join(", ");
	const incomplete = data.incomplete || v.incomplete;
	const over = verdictIsOver(v);
	const label = text(verdictLabel(v, data.book.style === "SAVE_FIRST"));
	const sentence = incomplete
		? t("hero.incomplete", { currencies: missing })
		: text(verdictSentence(v));
	const amount = incomplete
		? null
		: money(v.lead.amount, over ? { sign: "never" } : undefined);
	const shown =
		amount !== null && data.approximate
			? tm("approx", { amount })
			: amount;
	const sheet = canAct && !incomplete && v.action ? verdictSheet(v) : null;

	return (
		<View style={{ gap: space[1], paddingHorizontal: space[4] }}>
			<View
				accessible
				accessibilityLabel={`${label}, ${shown ?? tm("noRate")}. ${sentence}`}
				style={{ gap: space[1] }}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{label}
				</Text>
				<Text
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.hero.size,
						fontVariant: ["tabular-nums"],
						fontWeight: "600",
					}}
				>
					{shown ?? tm("noRate")}
				</Text>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{sentence}
				</Text>
			</View>
			{sheet && v.action ? (
				<View style={{ alignItems: "flex-start", paddingTop: space[2] }}>
					<Button
						label={t(
							`verdict.${verdictActionKey(v.action, v.lead.kind === "LEFT_IN_LIMITS")}` as "verdict.action.COVER",
						)}
						onPress={() => onAction(sheet)}
					/>
				</View>
			) : null}
		</View>
	);
}
