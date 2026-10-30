import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "./Text";

/** The operators the amount takes; the domain reads the typed sum exactly. */
const OPERATORS = [
	{ key: "plus", sign: "+" },
	{ key: "minus", sign: "−" },
	{ key: "times", sign: "×" },
	{ key: "divide", sign: "÷" },
] as const;

/** The four operator keys that add up an amount; any sheet with a typed amount can show them. */
export function OperatorKeys({
	onOperator,
}: {
	onOperator: (sign: string) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { color, radius, size, space } = useTheme();
	return (
		<View
			accessibilityLabel={t("ops.label")}
			style={{ flexDirection: "row", gap: space[2] }}
		>
			{OPERATORS.map((op) => (
				<Pressable
					accessibilityLabel={t(`ops.${op.key}`)}
					accessibilityRole="button"
					key={op.key}
					onPress={() => onOperator(op.sign)}
					style={({ pressed }) => ({
						minWidth: size.touchMin.phone,
						minHeight: size.touchMin.phone,
						alignItems: "center",
						justifyContent: "center",
						borderRadius: radius.chip,
						backgroundColor: pressed ? color.line : color.raised,
					})}
				>
					<Text variant="title" weight="medium">
						{op.sign}
					</Text>
				</Pressable>
			))}
		</View>
	);
}
