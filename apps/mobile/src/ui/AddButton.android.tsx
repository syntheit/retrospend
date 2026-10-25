import {
	DropdownMenu,
	DropdownMenuItem,
	ExtendedFloatingActionButton,
	FloatingActionButton,
	Text,
} from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { AddButtonProps } from "./types";

/**
 * The Material 3 extended FAB ("Add expense"), shrinking to the plus when the
 * list scrolls. With `actions` the FAB opens a menu (Add expense, Income,
 * Transfer); without, a tap adds.
 */
export function AddButton({
	label,
	onPress,
	expanded = true,
	actions,
}: AddButtonProps) {
	const { color } = useTheme();
	const [open, setOpen] = useState(false);
	const menu = actions && actions.length > 0 ? actions : null;
	const press = menu ? () => setOpen(true) : onPress;

	const fab = expanded ? (
		<ExtendedFloatingActionButton
			containerColor={color.brand}
			expanded
			onClick={press}
		>
			<ExtendedFloatingActionButton.Text>
				<Text color={color.brandFg}>{label}</Text>
			</ExtendedFloatingActionButton.Text>
		</ExtendedFloatingActionButton>
	) : (
		<FloatingActionButton containerColor={color.brand} onClick={press}>
			<FloatingActionButton.Icon>
				<Text color={color.brandFg}>+</Text>
			</FloatingActionButton.Icon>
		</FloatingActionButton>
	);

	return (
		<NativeHost>
			{menu ? (
				<DropdownMenu
					color={color.surface}
					expanded={open}
					onDismissRequest={() => setOpen(false)}
				>
					<DropdownMenu.Trigger>{fab}</DropdownMenu.Trigger>
					<DropdownMenu.Items>
						{[{ id: "main", label, onPress }, ...menu].map((item) => (
							<DropdownMenuItem
								key={item.id}
								onClick={() => {
									setOpen(false);
									item.onPress();
								}}
							>
								<DropdownMenuItem.Text>
									<Text>{item.label}</Text>
								</DropdownMenuItem.Text>
							</DropdownMenuItem>
						))}
					</DropdownMenu.Items>
				</DropdownMenu>
			) : (
				fab
			)}
		</NativeHost>
	);
}
