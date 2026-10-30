import {
	Button,
	HStack,
	Image,
	Menu as SwiftMenu,
	Text,
} from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	background,
	buttonStyle,
	font,
	foregroundStyle,
	frame,
	menuIndicator,
	menuStyle,
	padding,
	shapes,
	strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { MenuProps } from "./types";

/**
 * The filter chip as a SwiftUI label (GUIDELINE 5): control height, capsule,
 * a 1 point line-strong border, 13/500 fg-2 with a chevron; brand-soft with a
 * brand border while its filter has a value.
 */
function ChipLabel({ label, active }: { label: string; active: boolean }) {
	const { color, size, space, type } = useTheme();
	return (
		<HStack
			modifiers={[
				padding({ leading: space[3], trailing: space[2] }),
				frame({ height: size.ctl.phone }),
				background(active ? color.brandSoft : "transparent", shapes.capsule()),
				strokeBorder({
					content: active ? color.brand : color.lineStrong,
					shape: "capsule",
					style: { lineWidth: 1 },
				}),
			]}
			spacing={space[2]}
		>
			<Text
				modifiers={[
					font({ size: type.small.size, weight: "medium" }),
					foregroundStyle(active ? color.fg : color.fg2),
				]}
			>
				{label}
			</Text>
			<Image
				color={color.fg3}
				size={size.icon.phone}
				systemName="chevron.down"
			/>
		</HStack>
	);
}

/** The overflow mark: three dots at the 44 point touch size. */
function IconLabel() {
	const { color, size } = useTheme();
	return (
		<Image
			color={color.fg}
			modifiers={[
				frame({ width: size.touchMin.phone, height: size.touchMin.phone }),
			]}
			size={size.icon.phone}
			systemName="ellipsis"
		/>
	);
}

/** A page-level choice: 16/500 accent-strong with a chevron, no border. */
function HeadingLabel({ label }: { label: string }) {
	const { color, size, space, type } = useTheme();
	return (
		<HStack
			modifiers={[frame({ height: size.touchMin.phone })]}
			spacing={space[1]}
		>
			<Text
				modifiers={[
					font({ size: type.section.size, weight: "medium" }),
					foregroundStyle(color.accentStrong),
				]}
			>
				{label}
			</Text>
			<Image
				color={color.accentStrong}
				size={size.icon.phone}
				systemName="chevron.down"
			/>
		</HStack>
	);
}

/** A SwiftUI Menu: the system menu with its own material and haptics. */
export function Menu({
	label,
	accessibilityLabel,
	items,
	chip,
	active = false,
	icon,
	heading,
}: MenuProps) {
	const custom = chip || icon || heading;
	return (
		<NativeHost>
			<SwiftMenu
				label={
					chip ? (
						<ChipLabel active={active} label={label} />
					) : icon ? (
						<IconLabel />
					) : heading ? (
						<HeadingLabel label={label} />
					) : (
						label
					)
				}
				modifiers={[
					// A custom trigger is the whole control: no button chrome, no system chevron.
					...(custom
						? [
								menuStyle("button"),
								buttonStyle("plain"),
								menuIndicator("hidden"),
							]
						: []),
					...(accessibilityLabel || icon
						? [a11yLabel(accessibilityLabel ?? label)]
						: []),
				]}
			>
				{items.map((item) => (
					<Button
						key={item.id}
						label={item.label}
						onPress={item.onPress}
						role={item.destructive ? "destructive" : undefined}
					/>
				))}
			</SwiftMenu>
		</NativeHost>
	);
}
