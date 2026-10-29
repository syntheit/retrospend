import { FieldGroup, Host, Picker } from "@expo/ui";
import {
	background,
	listRowBackground,
	scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import type { FormMenuProps } from "./types";

// The platform half of ui/Form. On iOS the SwiftUI Form hides its system
// gray and sits on the page background; the rows take the surface token.

/** The SwiftUI Form on the bg token, the brand as its tint. */
export function FormFrame({ children }: { children: ReactNode }) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			seedColor={color.brand}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			<FieldGroup
				modifiers={[scrollContentBackground("hidden"), background(color.bg)]}
			>
				{children}
			</FieldGroup>
		</Host>
	);
}

/** Every row of a section on the surface token. */
export function useSectionModifiers() {
	const { color } = useTheme();
	return [listRowBackground(color.surface)];
}

/** The system menu picker: the value and its chevrons at the row's end. */
export function FormMenu<T extends string>({
	options,
	value,
	onChange,
}: FormMenuProps<T>) {
	return (
		<Picker<string>
			appearance="menu"
			onValueChange={(next) => onChange(next as T)}
			selectedValue={value}
		>
			{options.map((option) => (
				<Picker.Item
					key={option.value}
					label={option.label}
					value={option.value}
				/>
			))}
		</Picker>
	);
}
