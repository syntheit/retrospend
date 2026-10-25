import { Button, Menu as SwiftMenu } from "@expo/ui/swift-ui";
import { accessibilityLabel as a11yLabel } from "@expo/ui/swift-ui/modifiers";
import { NativeHost } from "./NativeHost";
import type { MenuProps } from "./types";

/** A SwiftUI Menu: the system menu with its own material and haptics. */
export function Menu({ label, accessibilityLabel, items }: MenuProps) {
	return (
		<NativeHost>
			<SwiftMenu
				label={label}
				modifiers={
					accessibilityLabel ? [a11yLabel(accessibilityLabel)] : undefined
				}
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
