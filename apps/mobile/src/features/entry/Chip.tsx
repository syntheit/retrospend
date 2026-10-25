import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { useTheme } from "@/theme";

/**
 * A choice in a row of choices: text only, or a face and a name for a
 * person. Brand marks the picked one. 36 high with a hit slop that reaches
 * the 44 point touch target.
 */
export function Chip({
	label,
	selected,
	onPress,
	leading,
	accessibilityLabel,
}: {
	label: string;
	selected: boolean;
	onPress: () => void;
	leading?: ReactNode;
	accessibilityLabel?: string;
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			accessibilityState={{ selected }}
			hitSlop={space[1]}
			onPress={onPress}
			style={{
				minHeight: size.ctl.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[3],
				borderRadius: radius.chip,
				borderWidth: 1,
				borderColor: selected ? color.brand : color.line,
				backgroundColor: selected ? color.brandSoft : color.surface,
			}}
		>
			{leading}
			<Text
				numberOfLines={1}
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontWeight: selected ? "600" : "400",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}
