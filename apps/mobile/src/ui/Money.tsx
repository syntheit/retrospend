import { Text } from "react-native";
import { type Money as MoneyValue, useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";

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
	const { color, type } = useTheme();
	const { format } = useFormatMoney();
	const text = value ? format(value) : fallback;
	return (
		<Text
			numberOfLines={1}
			style={{
				color:
					tone === "positive"
						? color.positive
						: tone === "muted"
							? color.fg3
							: color.fg,
				fontSize: type.body.size,
				fontVariant: ["tabular-nums"],
				fontWeight: strong ? "600" : "500",
				textAlign: "right",
			}}
		>
			{text}
		</Text>
	);
}
