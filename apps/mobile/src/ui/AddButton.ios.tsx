import { Button, Menu } from "@expo/ui/swift-ui";
import {
	buttonStyle,
	controlSize,
	labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import { NativeHost } from "./NativeHost";
import type { AddButtonProps } from "./types";

/**
 * The plus for toolbars (iPad) and anywhere the tab bar's own plus is not
 * shown. Tap adds; with `actions`, a long press opens the system menu
 * (Add income, Transfer). Glass comes from the system button style, which
 * is chrome only (R17).
 */
export function AddButton({ label, onPress, actions }: AddButtonProps) {
	// Large control size: the touch target reaches 44 pt (the regular one is 31).
	const modifiers = [
		buttonStyle("glassProminent"),
		controlSize("large"),
		labelStyle("iconOnly"),
	];
	return (
		<NativeHost>
			{actions && actions.length > 0 ? (
				<Menu
					label={label}
					modifiers={modifiers}
					onPrimaryAction={onPress}
					systemImage="plus"
				>
					{actions.map((action) => (
						<Button
							key={action.id}
							label={action.label}
							onPress={action.onPress}
						/>
					))}
				</Menu>
			) : (
				<Button
					label={label}
					modifiers={modifiers}
					onPress={onPress}
					systemImage="plus"
				/>
			)}
		</NativeHost>
	);
}
