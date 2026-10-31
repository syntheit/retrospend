import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { AvatarStack, type Face } from "./Avatar";
import { Glyph } from "./Glyph";
import { Text } from "./Text";

/**
 * A project as a choice in a panel: its cover, its name on one line (cut with
 * an ellipsis, never wrapped), and under it a small stack of faces with
 * "4 people · USD". The picked row has a brand border, a brand-soft fill and a
 * check, so it never rests on color alone. Passing no `onPress` draws it as
 * plain information (a saved expense keeps its project).
 */
export function ProjectRow({
	cover,
	name,
	meta,
	faces,
	selected,
	onPress,
	accessibilityLabel,
}: {
	/** The project's Cover. */
	cover: ReactNode;
	name: string;
	/** "4 people · USD". */
	meta: string;
	/** Who is in it besides you; a few are drawn. */
	faces: Face[];
	selected: boolean;
	onPress?: () => void;
	accessibilityLabel?: string;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? `${name}, ${meta}`}
			accessibilityRole="button"
			accessibilityState={{ selected, disabled: !onPress }}
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.touchMin.phone + space[2],
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingVertical: space[1],
				paddingLeft: space[2],
				paddingRight: space[3],
				borderRadius: radius.panel,
				borderWidth: 1,
				borderColor: selected ? color.brand : "transparent",
				backgroundColor: selected
					? color.brandSoft
					: pressed
						? color.raised
						: color.surface,
			})}
		>
			{cover}
			<View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
				<Text numberOfLines={1} weight="medium">
					{name}
				</Text>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					{faces.length > 0 ? (
						<AvatarStack faces={faces} max={3} ring="surface" size="xs" />
					) : null}
					<Text
						numberOfLines={1}
						style={{ flexShrink: 1 }}
						tone="fg3"
						variant="meta"
					>
						{meta}
					</Text>
				</View>
			</View>
			{selected ? (
				<Glyph color={color.brand} name="Check" size={size.icon.phone} />
			) : null}
		</Pressable>
	);
}
