import { FieldGroup, Host } from "@expo/ui";
import {
	DropdownMenu,
	DropdownMenuItem,
	HostPaletteContext,
	type MaterialColors,
	Text,
	TextButton,
	useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { type ReactNode, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import type { FormMenuProps } from "./types";

// The platform half of ui/Form. Compose's grouped list paints itself from the
// host palette, which the brand seed turns into a peach tonal scheme. The
// form keeps the seed for its switches but hands the list the tokens: the
// page on bg, the rows on surface, headers in fg-2.

type Hex = MaterialColors["primary"];

/** The M3 grouped list on the token surfaces. */
export function FormFrame({ children }: { children: ReactNode }) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	const colorScheme =
		scheme === "dark" || scheme === "light" ? scheme : undefined;
	const seeded = useMaterialColors({ colorScheme, seedColor: color.brand });
	const palette = useMemo<MaterialColors>(
		() => ({
			...seeded,
			background: color.bg as Hex,
			onBackground: color.fg as Hex,
			surface: color.bg as Hex,
			onSurface: color.fg as Hex,
			surfaceContainer: color.surface as Hex,
			onSurfaceVariant: color.fg2 as Hex,
		}),
		[seeded, color],
	);
	return (
		<Host
			colorScheme={colorScheme}
			seedColor={color.brand}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			<HostPaletteContext.Provider value={palette}>
				<FieldGroup style={{ backgroundColor: color.bg }}>
					{children}
				</FieldGroup>
			</HostPaletteContext.Provider>
		</Host>
	);
}

/** Compose rows take their colors from the palette above. */
export function useSectionModifiers() {
	return undefined;
}

/**
 * The value as a text button that opens an M3 menu, in place of the filled
 * exposed dropdown field the universal Picker draws.
 */
export function FormMenu<T extends string>({
	options,
	value,
	onChange,
}: FormMenuProps<T>) {
	const { color } = useTheme();
	const [open, setOpen] = useState(false);
	const current = options.find((option) => option.value === value);
	return (
		<DropdownMenu
			color={color.surface}
			expanded={open}
			onDismissRequest={() => setOpen(false)}
		>
			<DropdownMenu.Trigger>
				<TextButton
					colors={{ contentColor: color.fg2 }}
					onClick={() => setOpen(true)}
				>
					<Text>{current?.label ?? ""}</Text>
				</TextButton>
			</DropdownMenu.Trigger>
			<DropdownMenu.Items>
				{options.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => {
							setOpen(false);
							onChange(option.value);
						}}
					>
						<DropdownMenuItem.Text>
							<Text>{option.label}</Text>
						</DropdownMenuItem.Text>
					</DropdownMenuItem>
				))}
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}
