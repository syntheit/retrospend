import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";

/**
 * - choice: one of a row of choices (a split mode, a person); on reads as
 *   brand-soft with a brand border.
 * - trigger: shows a value and opens a picker (a currency, a project); always
 *   the neutral look, with a chevron.
 * - filter: narrows a list and opens a menu of values; on while a value is
 *   set, with a chevron.
 */
export type ChipVariant = "choice" | "trigger" | "filter";

/** The chevron a trigger or filter chip ends with: ChevronRight turned down. */
export function ChipChevron({ color }: { color: string }) {
	const { size } = useTheme();
	return (
		<View style={{ transform: [{ rotate: "90deg" }] }}>
			<Glyph color={color} name="ChevronRight" size={size.icon.phone} />
		</View>
	);
}

/**
 * The one chip (GUIDELINE 5): control height, pill radius, a line-strong
 * border, label 14/500. It may lead with an identity mark (a face, a bare
 * category glyph, a cover, a flag) and nothing else. The hit slop takes the
 * 36 point chip to the 44 point touch target.
 */
export function Chip({
	label,
	variant = "choice",
	selected = false,
	onPress,
	leading,
	accessibilityLabel,
}: {
	label: string;
	variant?: ChipVariant;
	/** On: a picked choice, or a filter with a value set. A trigger is never on. */
	selected?: boolean;
	onPress: () => void;
	leading?: ReactNode;
	accessibilityLabel?: string;
}) {
	const { color, font, radius, size, space, type } = useTheme();
	const on = selected && variant !== "trigger";
	const chevron = variant !== "choice";
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			accessibilityState={variant === "trigger" ? undefined : { selected: on }}
			hitSlop={space[1]}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.ctl.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
				paddingLeft: leading ? space[2] : space[3],
				paddingRight: chevron ? space[2] : space[3],
				borderRadius: radius.chip,
				borderWidth: 1,
				borderColor: on ? color.brand : color.lineStrong,
				backgroundColor: on
					? color.brandSoft
					: pressed
						? color.raised
						: variant === "trigger"
							? color.surface
							: "transparent",
			})}
		>
			{leading}
			<Text
				numberOfLines={1}
				style={{
					color: on || variant === "trigger" ? color.fg : color.fg2,
					fontSize: type.body.size,
					fontWeight: String(font.weight.medium) as "500",
				}}
			>
				{label}
			</Text>
			{chevron ? <ChipChevron color={color.fg3} /> : null}
		</Pressable>
	);
}
