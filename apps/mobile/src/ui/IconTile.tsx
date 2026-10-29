import { View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "./Glyph";

/**
 * A neutral tile with a glyph, for a row lead that is not a category (a kind
 * of account, a kind of thing that needs you): 32, radius 8, the raised fill
 * and an fg-2 glyph. `attention` is for a lead that needs the person now
 * (overdue). Rows only, never chips or pickers; it hides from screen readers
 * because the row's title says what it is.
 */
export function IconTile({
	name,
	tone = "neutral",
}: {
	name: GlyphName;
	tone?: "neutral" | "attention";
}) {
	const { color, radius, size } = useTheme();
	const tile = size.avatar.default;
	const attention = tone === "attention";
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: tile,
				height: tile,
				borderRadius: radius.ctl,
				backgroundColor: attention ? color.attentionBg : color.raised,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Glyph
				color={attention ? color.attentionText : color.fg2}
				name={name}
				size={size.icon.phone}
			/>
		</View>
	);
}
