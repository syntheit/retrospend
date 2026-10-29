import { type Money as MoneyValue, useFormatMoney } from "@/lib/money";
import { Text } from "./Text";

type Tone = "default" | "positive" | "muted";

/**
 * A money figure the server computed, formatted by the one domain formatter
 * (never a hand-built symbol). Right-aligned with tabular figures so a column
 * of them shares one edge; a missing value reads "No rate yet" style through
 * `fallback`, never 1 or 0.
 */
export function Money({
	value,
	tone = "default",
	fallback = "",
	strong,
}: {
	value: MoneyValue | null | undefined;
	tone?: Tone;
	fallback?: string;
	strong?: boolean;
}) {
	const { format } = useFormatMoney();
	const text = value ? format(value) : fallback;
	return (
		<Text
			numberOfLines={1}
			style={{ textAlign: "right" }}
			tabular
			tone={tone === "positive" ? "positive" : tone === "muted" ? "fg3" : "fg"}
			weight={strong ? "semibold" : "medium"}
		>
			{text}
		</Text>
	);
}
