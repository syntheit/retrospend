import { fromMinor, type Money } from "@retrospend/domain/money-minor";
import type { useRateFormat } from "@/lib/rateFormat";

type RateFormat = ReturnType<typeof useRateFormat>;

/** The server's Dollar today figure: the price of USD 1 in the home currency. */
interface DollarFigure {
	value: Money | null;
	home: string;
	others: readonly { rateType: string; value: Money }[];
}

/**
 * How the Dollar today tile reads (AGENTS rate rule: a rate is a number of at
 * least 1). A home currency worth more than a dollar (EUR, GBP) would read
 * "EUR 0.92", so the tile turns around and says "1 EUR = 1.09 USD", and the
 * other rate types of that day read in the same direction. For a weaker home
 * currency (ARS) the tile is unchanged: `sentence` is null and the figure is
 * the server's money.
 */
export function readDollar(
	dollar: DollarFigure,
	fmt: RateFormat,
): { sentence: string | null; others: (string | null)[] } {
	const dir = dollar.value
		? fmt.direction("USD", dollar.home, fromMinor(dollar.value))
		: null;
	if (!dollar.value || !dir || dir.base === "USD")
		return { sentence: null, others: dollar.others.map(() => null) };
	return {
		sentence: fmt.rate("USD", dollar.home, fromMinor(dollar.value)),
		others: dollar.others.map((o) =>
			fmt.inUnit(dir.base, "USD", dollar.home, fromMinor(o.value)),
		),
	};
}
