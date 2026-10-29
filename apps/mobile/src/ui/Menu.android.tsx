import {
	Box,
	DropdownMenu,
	DropdownMenuItem,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { semantics, size } from "@expo/ui/jetpack-compose/modifiers";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { Chip } from "./Chip";
import { NativeHost } from "./NativeHost";
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
				{items.map((item) => (
					<DropdownMenuItem
						key={item.id}
						onClick={() => {
							setOpen(false);
							item.onPress();
						}}
					>
						<DropdownMenuItem.Text>
							<Text color={item.destructive ? color.danger : undefined}>
								{item.label}
							</Text>
						</DropdownMenuItem.Text>
					</DropdownMenuItem>
				))}
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}

/**
 * An M3 dropdown menu anchored to a text button, or to a filter chip. The
 * chip is the app's own (ui/Chip, the same look on both platforms); the menu
 * hangs from a point under its leading edge.
 */
export function Menu({
	label,
	accessibilityLabel,
	items,
	chip,
	active = false,
}: MenuProps) {
	const [open, setOpen] = useState(false);
	if (chip) {
		return (
			<View>
				<Chip
					accessibilityLabel={accessibilityLabel ?? label}
					label={label}
					onPress={() => setOpen(true)}
					selected={active}
					variant="filter"
				/>
				<View
					pointerEvents="none"
					style={{ position: "absolute", left: 0, bottom: 0 }}
				>
					<NativeHost>
						<Dropdown
							items={items}
							open={open}
							setOpen={setOpen}
							trigger={<Box modifiers={[size(1, 1)]} />}
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
						<Text>{label}</Text>
					</TextButton>
				}
			/>
		</NativeHost>
	);
}
