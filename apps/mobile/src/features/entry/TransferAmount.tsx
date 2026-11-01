import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import type { MoneyLine } from "./AmountCard";

/** One row of the transfer's amount: what it is, its account, and the figure. */
export interface TransferRow {
	line: MoneyLine;
	/** "You send", "You receive". */
	title: string;
	/** The account's name. */
	account: string;
}

/**
 * The amount of a transfer: "You send" with its account and, between two
 * currencies, "You receive" under it. Each row is a button that points the
 * keypad at its figure; the row the keys type into carries the brand border
 * while the keys are up, and with the keys folded both rows rest on the raised
 * background like the single amount does.
 */
export function TransferAmount({
	rows,
	keysUp,
	error,
}: {
	rows: TransferRow[];
	/** The keypad is up: the active row is outlined. */
	keysUp: boolean;
	/** Add was pressed with no amount. */
	error: boolean;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			{rows.map(({ line, title, account }) => {
				const on = keysUp && line.active && rows.length > 1;
				return (
					<Pressable
						accessibilityLabel={`${title}, ${account}. ${line.spoken}`}
						accessibilityRole="button"
						accessibilityState={{ selected: line.active }}
						key={line.key}
						onPress={line.onPress}
						style={{
							minHeight: size.touchMin.phone + space[3],
							flexDirection: "row",
							alignItems: "center",
							gap: space[3],
							paddingHorizontal: space[3],
							paddingVertical: space[1],
							borderRadius: radius.panel,
							borderWidth: 1,
							borderColor: error
								? color.danger
								: on
									? color.brand
									: "transparent",
							backgroundColor: keysUp ? color.surface : color.raised,
						}}
					>
						<View style={{ flex: 1, minWidth: 0 }}>
							<Text scale="chrome" tone="fg3" variant="meta">
								{title}
							</Text>
							<Text numberOfLines={1} variant="small" weight="medium">
								{account}
							</Text>
						</View>
						<View
							style={{
								flexShrink: 1,
								flexDirection: "row",
								alignItems: "center",
								gap: space[2],
							}}
						>
							{line.currency}
							<Text
								accessibilityLiveRegion="polite"
								adjustsFontSizeToFit
								numberOfLines={1}
								style={{ flexShrink: 1, textAlign: "right" }}
								tabular
								tone={line.text ? "fg" : "fg3"}
								variant="title"
								weight="medium"
							>
								{line.text || line.placeholder}
							</Text>
						</View>
					</Pressable>
				);
			})}
		</View>
	);
}
