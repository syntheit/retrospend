import { HStack, Image, Button as SwiftButton, Text } from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	background,
	buttonStyle,
	controlSize,
	disabled as disabledModifier,
	font,
	foregroundStyle,
	frame,
	padding,
	shapes,
	strokeBorder,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonIcon, ButtonProps } from "./types";

/**
 * The SwiftUI style for each variant. Filled and danger are
 * borderedProminent: a solid fill in the tint. The glass styles (glass,
 * glassProminent) are for chrome only and lighten the tint, which is what
 * made the label unreadable (R17). Outlined and dangerText are plain: their
 * look is drawn by KitLabel.
 */
export const BUTTON_STYLE = {
	filled: "borderedProminent",
	outlined: "plain",
	text: "plain",
	danger: "borderedProminent",
	dangerText: "plain",
} as const;

/** The SF Symbol for each button glyph. */
const SYMBOL = {
	Trash2: "trash",
	Repeat: "repeat",
	Pencil: "pencil",
	Plus: "plus",
} as const satisfies Record<ButtonIcon, string>;

/**
 * The kit secondary and the danger-text ghost (kit.css .btn.secondary and
 * .btn.danger-text): a plain SwiftUI button whose label is drawn by hand so
 * the look is the tokens, not the system's gray bordered capsule. Secondary
 * is surface with a line-strong border and fg text; the ghost is bare danger
 * text. Small is the 28 point control at 13/500, regular the 36 point one at
 * 14/500.
 */
function KitLabel({
	label,
	variant,
	small,
	icon,
}: {
	label: string;
	variant: "outlined" | "dangerText";
	small: boolean;
	icon?: ButtonIcon;
}) {
	const { color, radius, size, space, type } = useTheme();
	const ink = variant === "outlined" ? color.fg : color.danger;
	return (
		<HStack
			modifiers={[
				padding({ horizontal: space[3] }),
				frame({ height: small ? size.ctlSm.phone : size.ctl.phone }),
				...(variant === "outlined"
					? [
							background(
								color.surface,
								shapes.roundedRectangle({ cornerRadius: radius.ctl }),
							),
							strokeBorder({
								content: color.lineStrong,
								shape: "roundedRectangle",
								cornerRadius: radius.ctl,
								style: { lineWidth: 1 },
							}),
						]
					: []),
			]}
			spacing={space[2]}
		>
			{icon ? (
				<Image color={ink} size={size.icon.phone} systemName={SYMBOL[icon]} />
			) : null}
			<Text
				modifiers={[
					font({
						size: small ? type.small.size : type.body.size,
						weight: "medium",
					}),
					foregroundStyle(ink),
				]}
			>
				{label}
			</Text>
		</HStack>
	);
}

/**
 * A SwiftUI button. Outlined and dangerText are the kit's secondary and
 * danger-text ghost (KitLabel). Filled sits on the brand tint, danger on the
 * danger tint; each label takes the token that reads on its fill, since the
 * system's own white is unreadable on the pale brand of the dark theme.
 * Small is the system's small control size.
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	size = "regular",
	icon,
	disabled,
}: ButtonProps) {
	const { color } = useTheme();
	if (variant === "outlined" || variant === "dangerText") {
		return (
			<NativeHost>
				<SwiftButton
					modifiers={[
						buttonStyle(BUTTON_STYLE[variant]),
						...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
						...(disabled ? [disabledModifier(true)] : []),
					]}
					onPress={onPress}
				>
					<KitLabel
						icon={icon}
						label={label}
						small={size === "small"}
						variant={variant}
					/>
				</SwiftButton>
			</NativeHost>
		);
	}
	const fill = variant === "danger" ? color.danger : color.brand;
	const ink =
		variant === "filled"
			? color.brandFg
			: variant === "danger"
				? color.dangerFg
				: color.brand;
	return (
		<NativeHost>
			<SwiftButton
				modifiers={[
					buttonStyle(BUTTON_STYLE[variant]),
					tint(fill),
					...(size === "small" ? [controlSize("small")] : []),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<Text modifiers={[foregroundStyle(ink)]}>{label}</Text>
			</SwiftButton>
		</NativeHost>
	);
}
