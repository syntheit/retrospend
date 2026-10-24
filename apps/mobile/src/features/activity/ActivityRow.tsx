import { Text, View } from "react-native";
import { useTheme } from "@/theme";
import { Money } from "@/ui/Money";
import type { ActivityItem } from "./source";

/**
 * The transaction row: title, a subline (what and when), the amount on the
 * right in its original currency, on a 44pt minimum row.
 */
export function ActivityRow({ item }: { item: ActivityItem }) {
	const { color, size, space, type } = useTheme();
	return (
		<View
			accessible
			style={{
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
				backgroundColor: color.bg,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{item.title}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{item.subline}
				</Text>
			</View>
			<Money value={item.amount} />
		</View>
	);
}
