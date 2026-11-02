import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import { Text } from "./Text";

/**
 * The Material 3 search bar at rest, on a list's page under the title
 * (Activity, People): a raised pill, a search mark and the placeholder, one
 * 56 point control. It does not take text: pressing it opens the expanded
 * search view (SearchView), the way the M3 search bar expands. A screen reader
 * hears a button named by the placeholder ("Search expenses").
 */
export function SearchPill({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			android_ripple={{ color: color.brandSoft }}
			onPress={onPress}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				height: space[12] + space[2],
				marginHorizontal: space[4],
				marginTop: space[2],
				marginBottom: space[3],
				paddingHorizontal: space[4],
				borderRadius: radius.chip,
				backgroundColor: color.raised,
				overflow: "hidden",
			}}
		>
			<Glyph color={color.fg2} name="Search" size={size.icon.phone} />
			<Text
				numberOfLines={1}
				scale="chrome"
				tone="fg2"
				variant="section"
				weight="normal"
			>
				{label}
			</Text>
		</Pressable>
	);
}
