import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";

type Money = { minor: number; currency: string };

/**
 * The words of "What this changes", shared by the full block and the one-line
 * preview above the Add bar: the name of each figure, a list in the person's
 * language, and money in one precision with the approximate mark. The numbers
 * are the server's dry run; nothing here computes one.
 */
export function useChangeWords() {
	const t = useTranslations("mobile.composer.changes");
	const tl = useTranslations("mobile.composer.list");
	const tm = useTranslations("mobile.money");
	const { format } = useFormatMoney();

	// One precision down a column: every amount shows its minor digits.
	const money = (value: Money, sign?: "exceptZero") =>
		format(value, { cents: true, sign }) ?? "";
	const marked = (text: string, approx: boolean) =>
		approx ? tm("approx", { amount: text }) : text;

	// Figure ids have dots, which message keys cannot. An id with no name of
	// its own reads "another figure", never the id.
	const name = (id: string, inline: boolean) => {
		const group = inline ? "figuresInline" : "figures";
		const key = `${group}.${id.replaceAll(".", "_")}`;
		// The key is built at run time, so it can not be checked against the catalog.
		return t.has(key as never) ? t(key as never) : t(`${group}.other` as never);
	};

	// A list in the person's language: the words between items are messages.
	const list = (items: string[]) => {
		if (items.length < 2) return items[0] ?? "";
		if (items.length === 2) {
			return tl("two", { first: items[0] ?? "", second: items[1] ?? "" });
		}
		return tl("many", {
			rest: items.slice(0, -1).join(tl("separator")),
			last: items[items.length - 1] ?? "",
		});
	};

	return { money, marked, name, list };
}
