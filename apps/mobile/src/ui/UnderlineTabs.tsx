import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/theme";
import { easeLand } from "./motion";
import { Text } from "./Text";

export interface UnderlineTab<T extends string> {
	value: T;
	label: string;
}

interface Box {
	x: number;
	width: number;
}

/**
 * The open tab of each tab set, so a page that remounts its tabs on a switch
 * (People and Projects carry them in each list's header) still slides the
 * line from where it was. Keyed by the set's values.
 */
const lastOpen = new Map<string, { value: string; at: number }>();
/** A remount this soon after a switch is that switch. */
const SWITCH_MS = 1000;

/**
 * The page tabs of the mockups (People and Projects, a project's Expenses,
 * Summary and People): a row of labels on one hairline, the open one in fg at
 * 600 with a 2 point accent underline, the others in fg-2 at 500. It switches
 * the content under it, so it is for pages; a choice inside a form stays the
 * segmented control. Each tab is 44 points tall (the touch target). A press
 * draws no box or ripple: the answer is the underline sliding to the tab
 * (220, the land curve, no overshoot); with reduced motion it fades across
 * instead. A screen reader hears a tab list with the open one selected. The
 * row scrolls sideways when its labels do not fit.
 */
export function UnderlineTabs<T extends string>({
	tabs,
	value,
	onChange,
	accessibilityLabel,
}: {
	tabs: UnderlineTab<T>[];
	value: T;
	onChange: (value: T) => void;
	accessibilityLabel: string;
}) {
	const theme = useTheme();
	const { color, duration, radius, size, space } = theme;
	const reduce = useReducedMotion();
	const ease = useMemo(() => easeLand(theme), [theme]);
	const key = tabs.map((tab) => tab.value).join("|");
	const [boxes, setBoxes] = useState<Record<string, Box>>({});
	const x = useSharedValue(0);
	const width = useSharedValue(0);
	const shown = useSharedValue(0);
	const placed = useRef(false);
	// Where the line starts: the tab that was open a moment ago when this set
	// just remounted on a switch, else the open one.
	const start = useRef<string>(value);
	if (!placed.current) {
		const last = lastOpen.get(key);
		if (last && Date.now() - last.at < SWITCH_MS) start.current = last.value;
	}

	useEffect(() => {
		lastOpen.set(key, { value, at: Date.now() });
	}, [key, value]);

	useEffect(() => {
		const to = boxes[value];
		// Every tab measured first, so the line knows where it comes from.
		if (!to || tabs.some((tab) => !boxes[tab.value])) return;
		if (!placed.current) {
			placed.current = true;
			const from = boxes[start.current];
			if (from && start.current !== value && !reduce) {
				x.value = from.x;
				width.value = from.width;
			} else {
				x.value = to.x;
				width.value = to.width;
				shown.value = 1;
				return;
			}
		}
		if (reduce) {
			// Opacity only: the line fades out, jumps, and fades in.
			shown.value = withTiming(0, { duration: duration.state / 2 }, () => {
				x.value = to.x;
				width.value = to.width;
				shown.value = withTiming(1, { duration: duration.state / 2 });
			});
			return;
		}
		shown.value = 1;
		x.value = withTiming(to.x, { duration: duration.tab, easing: ease });
		width.value = withTiming(to.width, {
			duration: duration.tab,
			easing: ease,
		});
	}, [
		boxes,
		tabs,
		value,
		reduce,
		duration.state,
		duration.tab,
		ease,
		shown,
		width,
		x,
	]);

	const line = useAnimatedStyle(() => ({
		opacity: shown.value,
		width: width.value,
		transform: [{ translateX: x.value }],
	}));

	return (
		<View
			style={{
				borderBottomWidth: 1,
				borderBottomColor: color.line,
				marginHorizontal: size.gutter.phone,
			}}
		>
			<ScrollView
				accessibilityLabel={accessibilityLabel}
				accessibilityRole="tablist"
				contentContainerStyle={{ gap: space[6] }}
				horizontal
				showsHorizontalScrollIndicator={false}
			>
				{tabs.map((tab) => {
					const on = tab.value === value;
					return (
						<Pressable
							accessibilityRole="tab"
							accessibilityState={{ selected: on }}
							key={tab.value}
							onLayout={(event) => {
								const { x: at, width: w } = event.nativeEvent.layout;
								setBoxes((prev) =>
									prev[tab.value]?.x === at && prev[tab.value]?.width === w
										? prev
										: { ...prev, [tab.value]: { x: at, width: w } },
								);
							}}
							onPress={() => onChange(tab.value)}
							style={{
								minHeight: size.touchMin.phone,
								justifyContent: "center",
							}}
						>
							<Text
								numberOfLines={1}
								tone={on ? "fg" : "fg2"}
								weight={on ? "semibold" : "medium"}
							>
								{tab.label}
							</Text>
						</Pressable>
					);
				})}
				<Animated.View
					pointerEvents="none"
					style={[
						{
							position: "absolute",
							left: 0,
							bottom: 0,
							height: space[1] / 2,
							borderRadius: radius.chip,
							backgroundColor: color.accent,
						},
						line,
					]}
				/>
			</ScrollView>
		</View>
	);
}
