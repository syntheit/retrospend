import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { useTheme } from "@/theme";

/**
 * One pick in a grid, at the 44 point target. A swatch is a 28 round fill
 * with a 2 point ring in fg while picked; an icon is a 36 square that takes
 * the brand-soft fill and a brand border while picked.
 */
export function Choice({
	selected,
	label,
	onPress,
	shape,
	fill,
	children,
}: {
	selected: boolean;
	label: string;
	onPress: () => void;
	shape: "swatch" | "icon";
	/** A swatch's color. */
	fill?: string;
	children?: ReactNode;
}) {
	const { color, radius, size, space } = useTheme();
	const round = shape === "swatch";
	const box = round ? size.ctlSm.phone : size.ctl.phone;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			accessibilityState={{ selected }}
			hitSlop={(size.touchMin.phone - box) / 2}
			onPress={onPress}
			style={{
				width: box,
				height: box,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: round ? box / 2 : radius.ctl,
				borderWidth: round ? space[1] / 2 : 1,
				borderColor: selected
					? round
						? color.fg
						: color.brand
					: "transparent",
				backgroundColor: round ? fill : selected ? color.brandSoft : undefined,
			}}
		>
			{children}
		</Pressable>
	);
}
