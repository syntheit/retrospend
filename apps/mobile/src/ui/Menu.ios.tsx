import { Button, Menu as SwiftMenu } from "@expo/ui/swift-ui";
import { NativeHost } from "./NativeHost";
import type { MenuProps } from "./types";

/** A SwiftUI Menu: the system menu with its own material and haptics. */
export function Menu({ label, items }: MenuProps) {
	return (
		<NativeHost>
			<SwiftMenu label={label}>
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
