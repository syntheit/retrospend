import {
	DropdownMenu,
	DropdownMenuItem,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { MenuProps } from "./types";

/** An M3 dropdown menu anchored to a text button. */
export function Menu({ label, accessibilityLabel, items }: MenuProps) {
	const { color } = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<NativeHost>
			<DropdownMenu
				color={color.surface}
				expanded={open}
				onDismissRequest={() => setOpen(false)}
			>
				<DropdownMenu.Trigger>
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
				</DropdownMenu.Trigger>
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
								<Text>{item.label}</Text>
							</DropdownMenuItem.Text>
						</DropdownMenuItem>
					))}
				</DropdownMenu.Items>
			</DropdownMenu>
		</NativeHost>
	);
}
