import { Box, DropdownMenu } from "@expo/ui/jetpack-compose";
import { size as sized } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { DropdownItems } from "./DropdownItems";
import { NativeHost } from "./NativeHost";
import { useTransient } from "./transient";
import type { MenuItem } from "./types";

/**
 * The M3 dropdown for a value row (Month start, Number format, Language): the
 * row shows the label and its value with a chevron, as every other value row
 * does, and a press opens this menu under the value. `children` is the value
 * the row draws; the menu hangs from its end. A tab switch closes it.
 */
export function ValueMenu({
	items,
	open,
	setOpen,
	children,
}: {
	items: MenuItem[];
	open: boolean;
	setOpen: (open: boolean) => void;
	children: ReactNode;
}) {
	const { color } = useTheme();
	useTransient(open ? () => setOpen(false) : null);
	return (
		<View style={{ flexShrink: 1 }}>
			{children}
			<View
				pointerEvents="none"
				style={{ position: "absolute", right: 0, bottom: 0 }}
			>
				<NativeHost>
					<DropdownMenu
						color={color.surface}
						expanded={open}
						onDismissRequest={() => setOpen(false)}
					>
						<DropdownMenu.Trigger>
							<Box modifiers={[sized(1, 1)]} />
						</DropdownMenu.Trigger>
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
				</NativeHost>
			</View>
		</View>
	);
}
