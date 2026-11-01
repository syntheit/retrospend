import { useTranslations } from "use-intl";
import type { MoneyLine } from "@/features/entry/AmountCard";
import { useFormatMoney } from "@/lib/money";
import { FixedCurrency } from "@/ui/AmountField";
import { type Entered, minorOf } from "./amount";

/**
 * The amount of a money sheet as the composer's amount block reads it: the
 * account's or book's currency shown (not picked), the typed text, and the
 * words a screen reader says. Zero counts when `allowZero` (an emptied
 * account).
 */
export function useAmountLine({
	currency,
	text,
	entered,
	allowZero,
	label,
	onPress,
}: {
	currency: string;
	text: string;
	entered: Entered;
	allowZero?: boolean;
	/** What the amount is ("What it holds today"): said before the figure. */
	label?: string;
	onPress: () => void;
}): MoneyLine {
	const t = useTranslations("mobile.composer");
	const { format } = useFormatMoney();
	const minor = minorOf(entered, allowZero);
	const said =
		minor !== null
			? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: t("amountEmpty", { currency });
	return {
		key: "amount",
		currency: <FixedCurrency code={currency} />,
		text,
		placeholder: "0",
		spoken: label ? `${label}, ${said}` : said,
		active: true,
		onPress,
	};
}
