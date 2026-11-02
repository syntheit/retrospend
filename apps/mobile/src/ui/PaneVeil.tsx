import { useEffect, useMemo, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import Animated, {
	ReduceMotion,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "@/theme";
import { LAYER } from "./metrics";
import { easeLand } from "./motion";

/** When the open tab last changed; a pane that mounts this soon after is the switch. */
let switchedAt = 0;
const SWITCH_MS = 600;

/** Call when the person switches the tabs a page's panes hang from. */
export function markPaneSwitch() {
	switchedAt = Date.now();
}

/**
 * The pane under tabs that live in the list's own header (the large-title
 * pages) arriving after a switch. The tabs and everything above them are not
 * touched: a cover in the page color sits right under the tabs, over the new
 * pane, and fades away (220, the land curve), so the content fades in while
 * the header does not move. Put it directly after the tabs, in the header
 * that holds them. It is a fade, so reduced motion keeps it (opacity only).
 * Nothing on the first render of a page, only on a switch.
 */
export function PaneVeil() {
	const theme = useTheme();
	const { color, duration } = theme;
	const { height } = useWindowDimensions();
	const [shown, setShown] = useState(() => Date.now() - switchedAt < SWITCH_MS);
	const opacity = useSharedValue(1);
	const ease = useMemo(() => easeLand(theme), [theme]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on mount
	useEffect(() => {
		if (!shown) return;
		opacity.value = withTiming(
			0,
			{
				duration: duration.tab,
				easing: ease,
				reduceMotion: ReduceMotion.Never,
			},
			(finished) => {
				if (finished) scheduleOnRN(setShown, false);
			},
		);
	}, []);

	const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
	if (!shown) return null;
	// A zero-height anchor: the cover hangs from it down over the pane.
	return (
		<View pointerEvents="none" style={{ height: 0, zIndex: LAYER.above }}>
			<Animated.View
				style={[
					{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height,
						backgroundColor: color.bg,
					},
					fade,
				]}
			/>
		</View>
	);
}
