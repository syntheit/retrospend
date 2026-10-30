import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { Text } from "@/ui/Text";

/**
 * A doorway to a page on Home's second row (home.html, phone A): the surface
 * with a 1px line and the panel radius, a glyph and a label (13, fg-2), the
 * figure, and at most two lines of 12 fg-3 under it. The whole tile opens its
 * page. `foot` sits at the bottom edge (the faces on Owed to you).
 */
export function HomeTile({
	glyph,
	label,
	spoken,
	onPress,
	children,
	foot,
	spans = false,
}: {
	glyph: GlyphName;
	label: string;
	/** What a screen reader says for the whole tile: the label, then the figures. */
	spoken: string;
	onPress: () => void;
	children?: ReactNode;
	foot?: ReactNode;
	/** Alone on its row, so it takes the width and only the height it needs. */
	spans?: boolean;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={spoken}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => ({
				flex: 1,
				minWidth: 0,
				minHeight: spans ? undefined : space[12] * 2 + space[6],
				padding: space[3],
				gap: space[1],
				backgroundColor: pressed ? color.raised : color.surface,
				borderWidth: 1,
				borderColor: color.line,
				borderRadius: radius.panel,
			})}
		>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				<Glyph color={color.fg2} name={glyph} size={size.icon.phone} />
				<Text numberOfLines={1} style={{ flex: 1 }} tone="fg2" variant="small">
					{label}
				</Text>
			</View>
			<View style={{ marginTop: space[2], gap: space[1] }}>{children}</View>
			{foot ? (
				<View style={{ marginTop: "auto", paddingTop: space[2] }}>{foot}</View>
			) : null}
		</Pressable>
	);
}

/** A line under a tile's figure: 12, fg-3. */
export function TileNote({ children }: { children: string }) {
	return (
		<Text numberOfLines={2} tone="fg3" variant="meta">
			{children}
		</Text>
	);
}
