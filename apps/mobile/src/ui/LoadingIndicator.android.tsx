import {
	LoadingIndicator as ComposeLoadingIndicator,
	ContainedLoadingIndicator,
} from "@expo/ui/jetpack-compose";
import {
	padding,
	semantics,
	size as sizeOf,
} from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { LoadingIndicatorProps } from "./types";

/** True while the system asks for less motion ("Remove animations"). */
function useReducedMotion(): boolean {
	const [reduce, setReduce] = useState(false);
	useEffect(() => {
		let live = true;
		AccessibilityInfo.isReduceMotionEnabled().then((on) => {
			if (live) setReduce(on);
		});
		const sub = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setReduce,
		);
		return () => {
			live = false;
			sub.remove();
		};
	}, []);
	return reduce;
}

/**
 * The Material 3 Expressive loading indicator: a shape that morphs while it
 * turns, for a wait that is in flight (a save, a sync, signing in). Compose is
 * bundled with the app, so it runs on every supported Android version. It is
 * neutral (fg-2, on raised when contained): it has no color job (GUIDELINE
 * §2.1). Skeletons stay for first loads and the RN refresh control for pull
 * to refresh. The morph runs under the standard motion scheme (patched into
 * @expo/ui), so it never overshoots.
 *
 * Reduced motion: the shape does not turn. A plain dot fades in and out
 * instead (opacity only, §11).
 */
export function LoadingIndicator({
	size = 24,
	contained,
	color,
	accessibilityLabel,
}: LoadingIndicatorProps) {
	const { color: c, duration } = useTheme();
	const t = useTranslations("mobile.common");
	const reduce = useReducedMotion();
	const label = accessibilityLabel ?? t("loading");
	const tone = color ?? c.fg2;

	if (reduce) {
		return (
			<PulseDot
				color={tone}
				duration={duration.tab}
				label={label}
				size={size}
			/>
		);
	}
	const modifiers = [
		sizeOf(size, size),
		semantics({ contentDescription: label }),
	];
	return (
		<NativeHost>
			{contained ? (
				<ContainedLoadingIndicator
					color={tone}
					containerColor={c.raised}
					modifiers={modifiers}
				/>
			) : (
				<ComposeLoadingIndicator color={tone} modifiers={modifiers} />
			)}
		</NativeHost>
	);
}

/**
 * The bare indicator for use inside another Compose control (a button's
 * content), where the surrounding Host already exists, with the gap to the
 * label after it. Under reduced motion it is left out and the label (which
 * says "Saving") carries the wait.
 */
export function InlineLoadingIndicator({
	size = 20,
	color,
	accessibilityLabel,
}: LoadingIndicatorProps) {
	const { color: c, space } = useTheme();
	const t = useTranslations("mobile.common");
	const reduce = useReducedMotion();
	if (reduce) return null;
	return (
		<ComposeLoadingIndicator
			color={color ?? c.fg2}
			modifiers={[
				padding(0, 0, space[2], 0),
				sizeOf(size, size),
				semantics({ contentDescription: accessibilityLabel ?? t("loading") }),
			]}
		/>
	);
}

function PulseDot({
	color,
	duration,
	label,
	size,
}: {
	color: string;
	duration: number;
	label: string;
	size: number;
}) {
	const opacity = useRef(new Animated.Value(1)).current;
	useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, {
					toValue: 0.3,
					duration,
					easing: Easing.linear,
					useNativeDriver: true,
				}),
				Animated.timing(opacity, {
					toValue: 1,
					duration,
					easing: Easing.linear,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [opacity, duration]);
	return (
		<View
			accessibilityLabel={label}
			accessibilityRole="progressbar"
			style={{
				width: size,
				height: size,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Animated.View
				style={{
					width: size / 2,
					height: size / 2,
					borderRadius: size / 4,
					backgroundColor: color,
					opacity,
				}}
			/>
		</View>
	);
}
