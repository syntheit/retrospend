import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Hero } from "@/ui/Hero";
import { LinkButton } from "@/ui/List";
import { Text } from "@/ui/Text";
import type { BudgetMonth } from "./source";
import { useVerdictText } from "./useVerdictText";
import {
	type VerdictSheet,
	verdictActionKey,
	verdictIsOver,
	verdictLabel,
	verdictSentence,
	verdictSheet,
} from "./verdict";

/**
 * The one hero of the page: one number, one sentence, at most one button, and
 * the link to Can I afford something. The server picks the state and carries
 * every figure (the verdict); this words it. A figure the server could not
 * work out (a missing rate) reads as words, never as 0.
 */
export function BudgetHero({
	data,
	names,
	canAct,
	canAfford,
	onAction,
	onAfford,
}: {
	data: BudgetMonth;
	names: ReadonlyMap<string, string>;
	/** False in a closed month: nothing there can change. */
	canAct: boolean;
	/** Can I afford something works in the open month and the next. */
	canAfford: boolean;
	onAction: (sheet: VerdictSheet) => void;
	onAfford: () => void;
}) {
	const t = useTranslations("mobile.budget");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const text = useVerdictText(names);
	const { space } = useTheme();
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
		amount !== null && data.approximate ? tm("approx", { amount }) : amount;
	const sheet = canAct && !incomplete && v.action ? verdictSheet(v) : null;

	return (
		<View style={{ gap: space[3] }}>
			<View style={{ paddingHorizontal: space[4] }}>
				<Hero
					label={label}
					sub={<Text>{sentence}</Text>}
					value={shown ?? tm("noRate")}
				/>
			</View>
			{sheet && v.action ? (
				<View style={{ alignItems: "flex-start", paddingHorizontal: space[4] }}>
					<Button
						label={t(
							`verdict.${verdictActionKey(v.action, v.lead.kind === "LEFT_IN_LIMITS")}` as "verdict.action.COVER",
						)}
						onPress={() => onAction(sheet)}
						size="small"
						variant="outlined"
					/>
				</View>
			) : null}
			{canAfford ? (
				<View style={{ alignItems: "flex-start" }}>
					<LinkButton label={t("hero.afford")} onPress={onAfford} />
				</View>
			) : null}
		</View>
	);
}
