import type { ReactNode } from "react";
import { useRef } from "react";
import { Pressable, Text } from "react-native";
import ReanimatedSwipeable, {
	type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useTheme } from "@/theme";
import { RowMenu } from "./RowMenu";
import type { MenuItem } from "./types";

export interface SwipeAction {
	label: string;
	onPress: () => void;
	/** Delete is danger, the main action is brand, the rest are neutral. */
	tone?: "brand" | "danger" | "neutral";
}

const ACTION_WIDTH = 88;

/**
 * A row with swipe actions and their long-press twin. Every action that can
 * be swiped is also in `menu` (the system action sheet on iOS, a bottom sheet
 * on Android), which is also what a screen reader or a hardware-keyboard user
 * reaches. The row's own tap is `onPress`. Swipes do not overshoot.
 */
export function SwipeRow({
	children,
	leading,
	trailing,
	menu,
	menuTitle,
	onPress,
}: {
	children: ReactNode;
	leading?: SwipeAction;
	trailing?: SwipeAction;
	menu: MenuItem[];
	menuTitle?: string;
	onPress?: () => void;
}) {
	const { color, space, type } = useTheme();
	const ref = useRef<SwipeableMethods>(null);

	const action = (a: SwipeAction) => (
		<Pressable
			accessibilityRole="button"
			onPress={() => {
				ref.current?.close();
				a.onPress();
			}}
			style={{
				width: ACTION_WIDTH,
				alignItems: "center",
				justifyContent: "center",
				paddingHorizontal: space[2],
				backgroundColor:
					a.tone === "danger"
						? color.danger
						: a.tone === "brand"
							? color.brand
							: color.fg2,
			}}
		>
			<Text
				numberOfLines={1}
				style={{
					color: a.tone === "danger" ? color.dangerFg : color.brandFg,
					fontSize: type.small.size,
					fontWeight: "600",
				}}
			>
				{a.label}
			</Text>
		</Pressable>
	);

	return (
		<ReanimatedSwipeable
			friction={2}
			overshootLeft={false}
			overshootRight={false}
			ref={ref}
			renderLeftActions={leading ? () => action(leading) : undefined}
			renderRightActions={trailing ? () => action(trailing) : undefined}
		>
			<RowMenu items={menu} onPress={onPress} title={menuTitle}>
				{children}
			</RowMenu>
		</ReanimatedSwipeable>
	);
}
