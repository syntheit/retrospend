import {
	Box,
	Text as ComposeText,
	DropdownMenu,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { semantics, size as sized } from "@expo/ui/jetpack-compose/modifiers";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Chip, ChipChevron } from "./Chip";
import { DropdownItems } from "./DropdownItems";
import { Glyph } from "./Glyph";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";
import { useTransient } from "./transient";
import type { MenuItem, MenuProps } from "./types";

/** The M3 dropdown with its items, opened from `trigger`. */
function Dropdown({
	open,
	setOpen,
	items,
	trigger,
}: {
	open: boolean;
	setOpen: (open: boolean) => void;
	items: MenuItem[];
	trigger: ReactNode;
}) {
	const { color } = useTheme();
	return (
		<DropdownMenu
			color={color.surface}
			expanded={open}
			onDismissRequest={() => setOpen(false)}
		>
			<DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Items>
				<DropdownItems
					items={items}
					onPick={(item) => {
						setOpen(false);
						item.onPress();
					}}
				/>
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}

/**
 * An M3 dropdown menu anchored to a text button, a filter chip, the overflow
 * mark or a page heading. The chip, the mark and the heading are the app's own
 * (React Native views, the same look on both platforms); the menu hangs from
 * a point under their leading edge.
 */
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
	const [open, setOpen] = useState(false);
	// A tab switch closes an open menu (transient UI).
	useTransient(open ? () => setOpen(false) : null);
	const { color, radius, size, space } = useTheme();
	const trigger = sortIcon ? (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			hitSlop={space[1]}
			onPress={() => setOpen(true)}
			style={{
				width: size.ctl.phone,
				height: size.ctl.phone,
				borderRadius: radius.chip,
				borderWidth: 1,
				borderColor: active ? color.brand : color.lineStrong,
				backgroundColor: active ? color.brandSoft : "transparent",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Glyph
				color={active ? color.fg : color.fg2}
				name="ArrowUpDown"
				size={size.icon.phone}
			/>
		</Pressable>
	) : chip ? (
		<Chip
			accessibilityLabel={accessibilityLabel ?? label}
			clearLabel={clearLabel}
			label={label}
			leading={
				leadingCalendar ? (
					<Glyph color={color.fg3} name="Calendar" size={size.icon.phone} />
				) : undefined
			}
			onClear={onClear}
			onPress={() => setOpen(true)}
			selected={active}
			variant="filter"
		/>
	) : icon ? (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			android_ripple={{ color: color.raised, borderless: true }}
			onPress={() => setOpen(true)}
			style={{
				width: size.touchMin.phone,
				height: size.touchMin.phone,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{raised ? (
				<View
					style={{
						width: size.ctlSm.phone,
						height: size.ctlSm.phone,
						borderRadius: size.ctlSm.phone / 2,
						backgroundColor: color.raised,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Glyph
						color={color.fg2}
						name="EllipsisVertical"
						size={size.icon.phone}
					/>
				</View>
			) : (
				<Glyph
					color={color.fg}
					name="EllipsisVertical"
					size={size.icon.phone}
				/>
			)}
		</Pressable>
	) : heading ? (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			android_ripple={{ color: color.raised }}
			onPress={() => setOpen(true)}
			style={{
				minHeight: size.touchMin.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[1],
			}}
		>
			<Text
				style={{ color: color.accentStrong }}
				variant="section"
				weight="medium"
			>
				{label}
			</Text>
			<ChipChevron color={color.accentStrong} />
		</Pressable>
	) : null;
	if (trigger) {
		return (
			<View>
				{trigger}
				<View
					pointerEvents="none"
					style={{ position: "absolute", left: 0, bottom: 0 }}
				>
					<NativeHost>
						<Dropdown
							items={items}
							open={open}
							setOpen={setOpen}
							trigger={<Box modifiers={[sized(1, 1)]} />}
						/>
					</NativeHost>
				</View>
			</View>
		);
	}
	return (
		<NativeHost>
			<Dropdown
				items={items}
				open={open}
				setOpen={setOpen}
				trigger={
					<TextButton
						modifiers={
							accessibilityLabel
								? [semantics({ contentDescription: accessibilityLabel })]
								: undefined
						}
						onClick={() => setOpen(true)}
					>
						<ComposeText>{label}</ComposeText>
					</TextButton>
				}
			/>
		</NativeHost>
	);
}
