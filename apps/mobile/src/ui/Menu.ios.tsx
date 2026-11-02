import {
	Button,
	HStack,
	Image,
	Menu as SwiftMenu,
	Text,
	Toggle,
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
import { MENU_SYMBOL } from "./menuIcons";
import { NativeHost } from "./NativeHost";
import { useChromeTextSize } from "./Text";
import type { MenuItem, MenuProps } from "./types";

/**
 * One row of the system menu. A list of options (`selected` set) is a
 * Toggle, which the menu draws with its checked state on the active row.
 */
function MenuRow({ item }: { item: MenuItem }) {
	if (item.selected !== undefined) {
		return (
			<Toggle
				isOn={item.selected}
				label={item.label}
				onIsOnChange={() => item.onPress()}
			/>
		);
	}
	return (
		<Button
			label={item.label}
			onPress={item.onPress}
			role={item.destructive ? "destructive" : undefined}
			systemImage={item.icon && MENU_SYMBOL[item.icon]}
		/>
	);
}

/**
 * The filter chip as a SwiftUI label (GUIDELINE 5): control height, capsule,
 * a 1 point line-strong border, 13/500 fg-2 with a chevron; brand-soft with a
 * brand border while its filter has a value.
 */
function ChipLabel({
	label,
	active,
	calendar,
	bare,
}: {
	label: string;
	active: boolean;
	calendar?: boolean;
	/** Inside a clearable chip: the capsule and the end mark are the chip's. */
	bare?: boolean;
}) {
	const { color, size, space, type } = useTheme();
	// Grows with the user's text size to the chrome cap, as the Chip's label does.
	const labelSize = useChromeTextSize(type.small.size);
	return (
		<HStack
			modifiers={[
				padding({
					leading: calendar ? space[2] : space[3],
					trailing: bare ? 0 : space[2],
				}),
				frame({ minHeight: size.ctl.phone }),
				...(bare ? [] : chipShape(active, color)),
			]}
			spacing={space[2]}
		>
			{calendar ? (
				<Image color={color.fg3} size={size.icon.phone} systemName="calendar" />
			) : null}
			<Text
				modifiers={[
					font({ size: labelSize, weight: "medium" }),
					foregroundStyle(active ? color.fg : color.fg2),
				]}
			>
				{label}
			</Text>
			{bare ? null : (
				<Image
					color={color.fg3}
					size={size.icon.phone}
					systemName="chevron.down"
				/>
			)}
		</HStack>
	);
}

/** The chip's capsule: brand-soft with a brand border while set. */
function chipShape(
	active: boolean,
	color: ReturnType<typeof useTheme>["color"],
) {
	return [
		background(active ? color.brandSoft : "transparent", shapes.capsule()),
		strokeBorder({
			content: active ? color.brand : color.lineStrong,
			shape: "capsule",
			style: { lineWidth: 1 },
		}),
	];
}

/** The sort chip: the arrows alone in a chip-height circle, brand-soft while a sort is set. */
function SortLabel({ active }: { active: boolean }) {
	const { color, size } = useTheme();
	return (
		<HStack
			modifiers={[
				frame({ width: size.ctl.phone, height: size.ctl.phone }),
				background(active ? color.brandSoft : "transparent", shapes.capsule()),
				strokeBorder({
					content: active ? color.brand : color.lineStrong,
					shape: "capsule",
					style: { lineWidth: 1 },
				}),
			]}
		>
			<Image
				color={active ? color.fg : color.fg2}
				size={size.icon.phone}
				systemName="arrow.up.arrow.down"
			/>
		</HStack>
	);
}

/** The overflow mark: three dots at the 44 point touch size. */
function IconLabel({ raised }: { raised?: boolean }) {
	const { color, size } = useTheme();
	if (raised) {
		// A sheet header's item: the raised 28 point circle of the pencil and
		// the close button, inside the 44 point touch target.
		return (
			<HStack
				modifiers={[
					frame({ width: size.touchMin.phone, height: size.touchMin.phone }),
				]}
			>
				<Image
					color={color.fg2}
					modifiers={[
						frame({ width: size.ctlSm.phone, height: size.ctlSm.phone }),
						background(color.raised, shapes.circle()),
					]}
					size={size.icon.phone}
					systemName="ellipsis"
				/>
			</HStack>
		);
	}
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
	raised,
	heading,
	leadingCalendar,
	sortIcon,
	onClear,
	clearLabel,
}: MenuProps) {
	const { color, size, space } = useTheme();
	const custom = chip || icon || heading || sortIcon;
	if (chip && active && onClear) {
		// A set chip that can be cleared: the menu opens from the label, and
		// the x after it clears the value, inside one capsule.
		return (
			<NativeHost>
				<HStack
					modifiers={[
						frame({ height: size.ctl.phone }),
						...chipShape(true, color),
					]}
					spacing={0}
				>
					<SwiftMenu
						label={
							<ChipLabel active bare calendar={leadingCalendar} label={label} />
						}
						modifiers={[
							menuStyle("button"),
							buttonStyle("plain"),
							menuIndicator("hidden"),
							...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
						]}
					>
						{items.map((item) => (
							<MenuRow item={item} key={item.id} />
						))}
					</SwiftMenu>
					<Button
						modifiers={[buttonStyle("plain"), a11yLabel(clearLabel ?? label)]}
						onPress={onClear}
					>
						<Image
							color={color.fg2}
							modifiers={[
								frame({ width: size.ctl.phone, height: size.ctl.phone }),
								padding({ trailing: space[1] }),
							]}
							size={size.icon.phone}
							systemName="xmark"
						/>
					</Button>
				</HStack>
			</NativeHost>
		);
	}
	return (
		<NativeHost>
			<SwiftMenu
				label={
					sortIcon ? (
						<SortLabel active={active} />
					) : chip ? (
						<ChipLabel
							active={active}
							calendar={leadingCalendar}
							label={label}
						/>
					) : icon ? (
						<IconLabel raised={raised} />
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
					...(accessibilityLabel || icon || sortIcon
						? [a11yLabel(accessibilityLabel ?? label)]
						: []),
				]}
			>
				{items.map((item) => (
							<MenuRow item={item} key={item.id} />
						))}
			</SwiftMenu>
		</NativeHost>
	);
}
