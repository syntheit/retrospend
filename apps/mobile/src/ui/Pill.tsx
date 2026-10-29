import { View } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "./Text";

/**
 * A short status word with its amount ("Over by $40") in the attention fill:
 * the word says it, the fill only marks that it needs the person. 24 high,
 * fully round, at the end of a row.
 */
export function Pill({ text }: { text: string }) {
	const { color, radius, space } = useTheme();
	return (
		<View
			style={{
				height: space[6],
				paddingHorizontal: space[3],
				borderRadius: radius.chip,
				backgroundColor: color.attentionBg,
				justifyContent: "center",
			}}
		>
			<Text
				numberOfLines={1}
				style={{ color: color.attentionText }}
				tabular
				variant="small"
				weight="semibold"
			>
				{text}
			</Text>
		</View>
	);
}
