import { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "./Glyph";
import { HAIRLINE } from "./metrics";
import { Text } from "./Text";

export interface SideNavItem {
	/** The route name under app/(tabs). */
	name: string;
	label: string;
	glyph: GlyphName;
}

export interface SideNavProps {
	/** "sidebar": a labeled list (landscape). "rail": icon over label (portrait). */
	variant: "sidebar" | "rail";
	items: readonly SideNavItem[];
	/** Shown after a gap at the bottom: Settings. */
	footerItems?: readonly SideNavItem[];
	/** The open destination's route name. */
	selected: string | undefined;
	onSelect: (name: string) => void;
}

/**
 * Provisional primitive: the Android tablet navigation (owner decision,
 * 2026-11-02). One component, two densities. The open destination is always one
 * lozenge around the icon and the label, never the icon alone. The sidebar
 * (232 wide, 40 high rows, 20 icons) matches the iPad sidebar's density; the
 * rail (88 wide) stacks the label under the icon. A press selects on press-in,
 * as the phone bar does, so the highlight never waits on the screen swap.
 */
export function SideNav({
	variant,
	items,
	footerItems = [],
	selected,
	onSelect,
}: SideNavProps) {
	const { color, size, space, radius } = useTheme();
	const insets = useSafeAreaInsets();
	const handled = useRef(false);
	const wide = variant === "sidebar";
	const width = wide ? size.sidebar.desktop : space[12] + space[8] + space[1] * 2;

	const entry = (item: SideNavItem) => {
		const on = item.name === selected;
		const tone = on ? color.brand : color.fg2;
		return (
			<Pressable
				accessibilityLabel={item.label}
				accessibilityRole="tab"
				accessibilityState={{ selected: on }}
				key={item.name}
				onPressIn={() => {
					handled.current = !on;
					if (!on) onSelect(item.name);
				}}
				onPress={() => {
					// Open already: the stack pops to its root (the tab press).
					if (!handled.current) onSelect(item.name);
				}}
				style={{
					flexDirection: wide ? "row" : "column",
					alignItems: "center",
					justifyContent: wide ? "flex-start" : "center",
					gap: wide ? space[3] : space[1] / 2,
					minHeight: wide ? size.row.desktop : space[12] + space[3],
					paddingHorizontal: wide ? space[3] : space[1],
					borderRadius: radius.chip,
					backgroundColor: on ? color.brandSoft : "transparent",
				}}
			>
				<Glyph color={tone} name={item.glyph} size={size.menuIcon.phone} />
				<Text
					numberOfLines={1}
					scale="chrome"
					style={{ color: tone }}
					variant={wide ? "body" : "meta"}
					weight={on ? "semibold" : "medium"}
				>
					{item.label}
				</Text>
			</Pressable>
		);
	};

	return (
		<View
			accessibilityRole="tablist"
			style={{
				width,
				paddingTop: insets.top + space[3],
				paddingBottom: insets.bottom + space[3],
				paddingLeft: Math.max(insets.left, 0) + space[2],
				paddingRight: space[2],
				backgroundColor: color.bg,
				borderRightWidth: HAIRLINE,
				borderRightColor: color.line,
			}}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[1] }}
				showsVerticalScrollIndicator={false}
			>
				{items.map(entry)}
			</ScrollView>
			{footerItems.length > 0 ? (
				<View style={{ gap: space[1], paddingTop: space[2] }}>
					{footerItems.map(entry)}
				</View>
			) : null}
		</View>
	);
}
