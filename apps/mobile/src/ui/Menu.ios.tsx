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
 * a 1 point line-strong border, fg-2 at 500 with a chevron; brand-soft with a
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
					font({ size: type.body.size, weight: "medium" }),
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

/** A SwiftUI Menu: the system menu with its own material and haptics. */
export function Menu({
	label,
	accessibilityLabel,
	items,
	chip,
	active = false,
}: MenuProps) {
	return (
		<NativeHost>
			<SwiftMenu
				label={chip ? <ChipLabel active={active} label={label} /> : label}
				modifiers={[
					// The chip is the whole trigger: no button chrome, no system chevron.
					...(chip
						? [
								menuStyle("button"),
								buttonStyle("plain"),
								menuIndicator("hidden"),
							]
						: []),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
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
