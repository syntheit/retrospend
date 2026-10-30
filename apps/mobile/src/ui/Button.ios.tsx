import { Host } from "@expo/ui";
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
	opacity,
	padding,
	shapes,
	strokeBorder,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonIcon, ButtonProps } from "./types";

/**
 * The SwiftUI style for each variant. Every kit button (filled, outlined,
 * danger, dangerText) is a plain SwiftUI button whose label KitLabel draws
 * at the kit's size: the system's borderedProminent capsule is taller with a
 * larger label, so a row of buttons did not share one height. The glass
 * styles (glass, glassProminent) are for chrome only and lighten the tint,
 * which is what made the label unreadable (R17).
 */
export const BUTTON_STYLE = {
	filled: "plain",
	outlined: "plain",
	text: "plain",
	danger: "plain",
	dangerText: "plain",
} as const;

/** A disabled kit button fades to this (kit.css .btn:disabled). */
const DISABLED_OPACITY = 0.45;

type KitVariant = "filled" | "outlined" | "danger" | "dangerText";

/** The SF Symbol for each button glyph. */
const SYMBOL = {
	Trash2: "trash",
	Repeat: "repeat",
	Pencil: "pencil",
	Plus: "plus",
} as const satisfies Record<ButtonIcon, string>;

/**
 * A kit button's label (kit.css .btn), drawn by hand so the look is the
 * tokens, not the system's capsules: primary is the brand fill with the
 * brand foreground, danger the danger fill with its own foreground,
 * secondary is surface with a line-strong border and fg text, and the ghost
 * is bare danger text. Small is the 28 point control at 13/500, regular the
 * 36 point one at 14/500, so buttons in one row share one height.
 */
function KitLabel({
	label,
	variant,
	small,
	icon,
	disabled,
	stretch,
}: {
	label: string;
	variant: KitVariant;
	small: boolean;
	icon?: ButtonIcon;
	disabled?: boolean;
	stretch?: boolean;
}) {
	const { color, radius, size, space, type } = useTheme();
	const ink = {
		filled: color.brandFg,
		danger: color.dangerFg,
		outlined: color.fg,
		dangerText: color.danger,
	}[variant];
	const fill =
		variant === "filled"
			? color.brand
			: variant === "danger"
				? color.danger
				: variant === "outlined"
					? color.surface
					: null;
	const shape = shapes.roundedRectangle({ cornerRadius: radius.ctl });
	return (
		<HStack
			modifiers={[
				padding({ horizontal: space[3] }),
				frame({
					height: small ? size.ctlSm.phone : size.ctl.phone,
					...(stretch ? { maxWidth: Infinity } : {}),
				}),
				...(fill ? [background(fill, shape)] : []),
				...(variant === "outlined"
					? [
							strokeBorder({
								content: color.lineStrong,
								shape: "roundedRectangle",
								cornerRadius: radius.ctl,
								style: { lineWidth: 1 },
							}),
						]
					: []),
				...(disabled ? [opacity(DISABLED_OPACITY)] : []),
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
 * A SwiftUI button. Filled, outlined, danger and dangerText are the kit's
 * buttons (KitLabel); each label takes the token that reads on its fill,
 * since the system's own white is unreadable on the pale brand of the dark
 * theme. Text is the system's plain button in the brand color, small at the
 * system's small control size.
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	size = "regular",
	icon,
	disabled,
	fill,
}: ButtonProps) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	if (variant !== "text") {
		const button = (
			<SwiftButton
				modifiers={[
					buttonStyle(BUTTON_STYLE[variant]),
					...(fill ? [frame({ maxWidth: Infinity })] : []),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<KitLabel
					disabled={disabled}
					icon={icon}
					label={label}
					small={size === "small"}
					stretch={fill}
					variant={variant}
				/>
			</SwiftButton>
		);
		if (fill) {
			// A host that matches the height only, so the button takes the width
			// its row gives it (two equal halves on a card).
			return (
				<Host
					colorScheme={
						scheme === "dark" || scheme === "light" ? scheme : undefined
					}
					matchContents={{ vertical: true }}
					seedColor={color.brand}
					style={{ alignSelf: "stretch" }}
				>
					{button}
				</Host>
			);
		}
		return <NativeHost>{button}</NativeHost>;
	}
	return (
		<NativeHost>
			<SwiftButton
				modifiers={[
					buttonStyle(BUTTON_STYLE.text),
					tint(color.brand),
					...(size === "small" ? [controlSize("small")] : []),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<Text modifiers={[foregroundStyle(color.brand)]}>{label}</Text>
			</SwiftButton>
		</NativeHost>
	);
}
