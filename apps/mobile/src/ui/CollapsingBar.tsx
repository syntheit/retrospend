import { type ReactNode, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
	Extrapolation,
	interpolate,
	interpolateColor,
	useAnimatedReaction,
	useAnimatedStyle,
	useReducedMotion,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "@/theme";
import { useBarMetrics, useCollapsingBar } from "./barScroll";
import { Text } from "./Text";

/**
 * The Material 3 large top app bar of a tab root on Android: the icon row on
 * top, the title at 32/600 under it, and as the list scrolls the title
 * shrinks to 22/600 into the row while the bar steps from the page color to
 * the surface and draws a hairline once it has collapsed. Every number is a
 * function of the list's scroll offset (UI thread), so it follows the finger
 * with no timed animation and no overshoot; with reduced motion the large
 * title fades into the small one instead of moving.
 *
 * It is drawn over the screen: the lists of the screen pad their top by the
 * bar's height (barScroll). `footer` is a row pinned under the bar that rides
 * with it (People's tabs), as tall as the provider's `footer`.
 *
 * Provisional: a new primitive (M3 on Android), waiting for the owner's sign-off.
 */
export function CollapsingBar({
	title,
	trailing,
	footer,
}: {
	title: string;
	/** The page's icon actions, the overflow mark and the account button. */
	trailing?: ReactNode;
	footer?: ReactNode;
}) {
	const bar = useCollapsingBar();
	const footerHeight = bar?.footer ?? 0;
	const { color, space, type, size } = useTheme();
	const m = useBarMetrics(footerHeight);
	const { width } = useWindowDimensions();
	const reduce = useReducedMotion();
	// The room the actions take, so the small title ends before them.
	const [trailWidth, setTrailWidth] = useState(size.touchMin.phone * 4);
	const offset = bar?.offset;

	const ratio = type.title.size / type.hero.size;
	const largeTop = m.inset + m.row + space[2];
	const smallTop = m.inset + (m.row - m.titleLine * ratio) / 2;
	const titleWidth = (width - space[4] - space[2] - trailWidth) / ratio;

	const sheet = useAnimatedStyle(() => {
		const p = offset
			? interpolate(offset.value, [0, m.large], [0, 1], Extrapolation.CLAMP)
			: 0;
		return {
			backgroundColor: interpolateColor(p, [0, 1], [color.bg, color.surface]),
			transform: [{ translateY: -p * m.large }],
		};
	});
	const hairline = useAnimatedStyle(() => ({
		opacity: offset
			? interpolate(
					offset.value,
					[m.large - space[2], m.large],
					[0, 1],
					Extrapolation.CLAMP,
				)
			: 0,
	}));
	const shrink = useAnimatedStyle(() => {
		const p = offset
			? interpolate(offset.value, [0, m.large], [0, 1], Extrapolation.CLAMP)
			: 0;
		return {
			transform: [
				{ translateY: p * (smallTop - largeTop) },
				{ scale: 1 - p * (1 - ratio) },
			],
		};
	});
	const fadeLarge = useAnimatedStyle(() => ({
		opacity: offset
			? interpolate(offset.value, [0, m.large], [1, 0], Extrapolation.CLAMP)
			: 1,
	}));
	const fadeSmall = useAnimatedStyle(() => ({
		opacity: offset
			? interpolate(offset.value, [0, m.large], [0, 1], Extrapolation.CLAMP)
			: 0,
	}));

	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				height: m.expanded,
				zIndex: 2,
			}}
		>
			<Animated.View
				style={[
					{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: m.expanded,
					},
					sheet,
				]}
			>
				{reduce ? (
					<Animated.View
						pointerEvents="none"
						style={[
							{
								position: "absolute",
								left: space[4],
								top: largeTop,
								right: space[4],
							},
							fadeLarge,
						]}
					>
						<Text
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
							numberOfLines={1}
							scale="chrome"
							variant="hero"
						>
							{title}
						</Text>
					</Animated.View>
				) : null}
				{footer ? (
					<View
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							height: footerHeight,
							justifyContent: "flex-end",
						}}
					>
						{footer}
					</View>
				) : (
					<Animated.View
						pointerEvents="none"
						style={[
							{
								position: "absolute",
								left: 0,
								right: 0,
								bottom: 0,
								height: StyleSheet.hairlineWidth,
								backgroundColor: color.line,
							},
							hairline,
						]}
					/>
				)}
			</Animated.View>
			{reduce ? (
				<Animated.View
					pointerEvents="none"
					style={[
						{
							position: "absolute",
							left: space[4],
							top: m.inset,
							height: m.row,
							width: titleWidth * ratio,
							justifyContent: "center",
						},
						fadeSmall,
					]}
				>
					<Text
						accessibilityRole="header"
						numberOfLines={1}
						scale="chrome"
						variant="title"
					>
						{title}
					</Text>
				</Animated.View>
			) : (
				<Animated.View
					pointerEvents="none"
					style={[
						{
							position: "absolute",
							left: space[4],
							top: largeTop,
							width: titleWidth,
							transformOrigin: "left top",
						},
						shrink,
					]}
				>
					<Text
						accessibilityRole="header"
						numberOfLines={1}
						scale="chrome"
						variant="hero"
					>
						{title}
					</Text>
				</Animated.View>
			)}
			<View
				onLayout={(event) => setTrailWidth(event.nativeEvent.layout.width)}
				pointerEvents="box-none"
				style={{
					position: "absolute",
					top: m.inset,
					right: space[2],
					height: m.row,
					flexDirection: "row",
					alignItems: "center",
				}}
			>
				{trailing}
			</View>
		</View>
	);
}

/**
 * Shows its child only once the bar has collapsed (Activity's and People's
 * search icon, while the search bar is on the page). The space stays, so the
 * title and the other actions do not move. Hidden, it takes no touch and is
 * not read out.
 */
export function RevealOnCollapse({ children }: { children: ReactNode }) {
	const bar = useCollapsingBar();
	const { space } = useTheme();
	const m = useBarMetrics(bar?.footer ?? 0);
	const [shown, setShown] = useState(false);
	const offset = bar?.offset;
	useAnimatedReaction(
		() => (offset ? offset.value >= m.large - space[2] : false),
		(now, before) => {
			if (now !== before) scheduleOnRN(setShown, now);
		},
	);
	const fade = useAnimatedStyle(() => ({
		opacity: offset
			? interpolate(
					offset.value,
					[m.large - space[4], m.large],
					[0, 1],
					Extrapolation.CLAMP,
				)
			: 0,
	}));
	return (
		<Animated.View
			accessibilityElementsHidden={!shown}
			importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
			pointerEvents={shown ? "auto" : "none"}
			style={fade}
		>
			{children}
		</Animated.View>
	);
}
