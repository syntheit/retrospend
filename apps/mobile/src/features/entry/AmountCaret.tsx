import { useEffect } from "react";
import { useWindowDimensions } from "react-native";
import Animated, {
	cancelAnimation,
	ReduceMotion,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withDelay,
	withRepeat,
	withSequence,
	withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/theme";
import { TEXT_SCALE_CAP } from "@/ui/Text";

/**
 * The blinking cursor that marks the amount the keypad types into. It is the
 * brand color, as tall as the figure, and fades out and in on the token
 * durations (rests two row durations, fades in one state duration). Reduced
 * motion: it stays solid. It is for the eye only; the amount's own label is
 * what a screen reader gets.
 */
export function AmountCaret({
	role = "hero",
}: {
	/** The type role of the figure it sits after. */
	role?: "hero" | "title";
}) {
	const { color, duration, space, type } = useTheme();
	const { fontScale } = useWindowDimensions();
	const reduce = useReducedMotion();
	const opacity = useSharedValue(1);
	useEffect(() => {
		if (reduce) {
			opacity.value = 1;
			return;
		}
		const rest = duration.row * 2;
		const fade = { duration: duration.state, reduceMotion: ReduceMotion.Never };
		opacity.value = withRepeat(
			withSequence(
				withDelay(rest, withTiming(0, fade)),
				withDelay(rest, withTiming(1, fade)),
			),
			-1,
		);
		return () => cancelAnimation(opacity);
	}, [reduce, duration.row, duration.state, opacity]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	const scaled =
		type[role].size * Math.min(Math.max(fontScale, 1), TEXT_SCALE_CAP.body);
	return (
		<Animated.View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[
				{
					width: space[1] / 2,
					height: Math.round(scaled * 0.85),
					marginLeft: space[1],
					borderRadius: space[1] / 4,
					backgroundColor: color.brand,
				},
				style,
			]}
		/>
	);
}
