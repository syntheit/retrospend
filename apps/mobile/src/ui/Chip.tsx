import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import { Text } from "./Text";

/**
 * - choice: one of a row of choices (a split mode, a person); on reads as
 *   brand-soft with a brand border.
 * - trigger: shows a value and opens a picker (a currency, a project); always
 *   the neutral look, with a chevron.
 * - filter: narrows a list and opens a menu of values; on while a value is
 *   set, with a chevron (or a clear mark, see `onClear`).
 */
export type ChipVariant = "choice" | "trigger" | "filter";

/** The chevron a trigger or filter chip ends with: ChevronRight turned down. */
export function ChipChevron({
	color,
	direction = "down",
}: {
	color: string;
	direction?: "down" | "right";
}) {
	const { size } = useTheme();
	return (
		<View
			style={direction === "down" ? { transform: [{ rotate: "90deg" }] } : null}
		>
			<Glyph color={color} name="ChevronRight" size={size.icon.phone} />
		</View>
	);
}

/**
 * The one chip (GUIDELINE 5): control height, pill radius, a line-strong
 * border, label 13/500 (fg-2 while unset, fg once a value is set, on brand-soft). It may lead with an identity mark (a face, a bare
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
	onClear,
	clearLabel,
	chevron: chevronDirection = "down",
}: {
	label: string;
	variant?: ChipVariant;
	/** On: a picked choice, or a filter with a value set. A trigger is never on. */
	selected?: boolean;
	onPress: () => void;
	leading?: ReactNode;
	accessibilityLabel?: string;
	/**
	 * A chip that is on and can be cleared (a set period, a picked project):
	 * the end mark is an x that calls this, in place of the chevron. Needs
	 * `clearLabel`.
	 */
	onClear?: () => void;
	clearLabel?: string;
	/**
	 * Which way the end chevron points: down opens a picker or menu (default),
	 * right goes on to another step (More).
	 */
	chevron?: "down" | "right";
}) {
	const { color, radius, size, space } = useTheme();
	const on = selected && variant !== "trigger";
	const clear = on && onClear !== undefined;
	const chevron =
		(variant !== "choice" || chevronDirection === "right") && !clear;
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
				paddingRight: chevron || clear ? space[2] : space[3],
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
				tone={on || variant === "trigger" ? "fg" : "fg2"}
				variant="small"
				weight="medium"
			>
				{label}
			</Text>
			{chevron ? (
				<ChipChevron color={color.fg3} direction={chevronDirection} />
			) : null}
			{clear ? (
				<Pressable
					accessibilityLabel={clearLabel ?? label}
					accessibilityRole="button"
					hitSlop={space[2]}
					onPress={onClear}
				>
					<Glyph color={color.fg2} name="X" size={size.icon.phone} />
				</Pressable>
			) : null}
		</Pressable>
	);
}
