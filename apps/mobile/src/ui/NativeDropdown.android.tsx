import {
	Text as ComposeText,
	DropdownMenuItem,
	ExposedDropdownMenu,
	ExposedDropdownMenuBox,
	TextField,
	useNativeState,
} from "@expo/ui/jetpack-compose";
import { menuAnchor } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useState } from "react";
import { useTheme } from "@/theme";
import { dropdownFieldColors } from "./m3Colors";

/**
 * The M3 exposed dropdown, laid out as the universal Picker does on Android
 * but with the field and the menu given token colors (the seed would tint
 * them).
 */
export function NativeDropdown({
	options,
	value,
	onChange,
}: {
	options: { value: string; label: string }[];
	value: string;
	onChange: (value: string) => void;
}) {
	const { color } = useTheme();
	const [expanded, setExpanded] = useState(false);
	const shown = options.find((o) => o.value === value)?.label ?? "";
	// The field's text lives in native state (TextField has no defaultValue
	// prop): start at the label and push it when it changes.
	const text = useNativeState(shown);
	useEffect(() => {
		text.set(shown);
	}, [shown, text]);
	return (
		<ExposedDropdownMenuBox expanded={expanded} onExpandedChange={setExpanded}>
			<TextField
				colors={dropdownFieldColors(color)}
				modifiers={[menuAnchor()]}
				readOnly
				value={text}
			/>
			<ExposedDropdownMenu
				containerColor={color.raised}
				expanded={expanded}
				onDismissRequest={() => setExpanded(false)}
			>
				{options.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => {
							onChange(option.value);
							setExpanded(false);
						}}
					>
						<DropdownMenuItem.Text>
							<ComposeText color={color.fg}>{option.label}</ComposeText>
						</DropdownMenuItem.Text>
					</DropdownMenuItem>
				))}
			</ExposedDropdownMenu>
		</ExposedDropdownMenuBox>
	);
}
