import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import { Text } from "./Text";
import type { TopBarAction as Action } from "./types";

/** The most a badge counts to; more reads "9+". */
const BADGE_MAX = 9;

/**
 * One icon-only page action in the top bar (Add person, New project): a bare
 * glyph with the 44 point touch target, labeled for screen readers. It sits
 * before the overflow mark and the account button, never as a filled button.
 * A `badge` count rides on the glyph's corner in the attention fill; the
 * label should say it too, so it is not color alone.
 */
export function TopBarAction({ icon, label, onPress, badge, testID }: Action) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			testID={testID}
			style={({ pressed }) => ({
				width: size.touchMin.phone,
				height: size.touchMin.phone,
				borderRadius: size.touchMin.phone / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: pressed ? color.raised : "transparent",
			})}
		>
			<Glyph color={color.fg} name={icon} size={size.icon.phone} />
			{badge && badge > 0 ? (
				<View
					style={{
						position: "absolute",
						top: space[1],
						right: space[1],
						minWidth: space[4],
						height: space[4],
						paddingHorizontal: space[1],
						borderRadius: radius.chip,
						backgroundColor: color.attentionBg,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text
						style={{ color: color.attentionText }}
						tabular
						variant="meta"
						weight="semibold"
					>
						{badge > BADGE_MAX ? `${BADGE_MAX}+` : String(badge)}
					</Text>
				</View>
			) : null}
		</Pressable>
	);
}
