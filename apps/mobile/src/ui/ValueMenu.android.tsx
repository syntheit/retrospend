import { Box } from "@expo/ui/jetpack-compose";
import { size as sized } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { View } from "react-native";
import { DropdownPanel } from "./DropdownItems";
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
	useTransient(open ? () => setOpen(false) : null);
	return (
		// The cap sits here, on the row's own child, and not on the value inside.
		<View style={{ flexShrink: 1, maxWidth: "65%" }}>
			{children}
			<View
				pointerEvents="none"
				style={{ position: "absolute", right: 0, bottom: 0 }}
			>
				<NativeHost>
					<DropdownPanel
						items={items}
						onDismiss={() => setOpen(false)}
						onPick={(item) => {
							setOpen(false);
							item.onPress();
						}}
						open={open}
						trigger={<Box modifiers={[sized(1, 1)]} />}
					/>
				</NativeHost>
			</View>
		</View>
	);
}
