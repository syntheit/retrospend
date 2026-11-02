import { useTranslations } from "use-intl";
import { useList } from "@/lib/list";
import { useFormatMoney } from "@/lib/money";

type Money = { minor: number; currency: string };

/**
 * The words of "What this changes", shared by the full block and the one-line
 * preview above the Add bar: a list in the person's language, and money in one
 * precision with the approximate mark. The numbers are the server's dry run;
 * nothing here computes one.
 */
export function useChangeWords() {
	const tm = useTranslations("mobile.money");
	const { format } = useFormatMoney();

	// One precision down a column: every amount shows its minor digits.
	const money = (value: Money, sign?: "exceptZero") =>
		format(value, { cents: true, sign }) ?? "";
	const marked = (text: string, approx: boolean) =>
		approx ? tm("approx", { amount: text }) : text;

	const list = useList();

	return { money, marked, list };
}
