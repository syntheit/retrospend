import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
	ReduceMotion,
	useAnimatedReaction,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "@/theme";
import { useInGroup } from "./List";
import { easeLand } from "./motion";
import { RowMenu } from "./RowMenu";
import { Text } from "./Text";
import { useTransient } from "./transient";
import type { MenuItem } from "./types";

export interface SwipeAction {
	label: string;
	onPress: () => void;
	/** Delete is danger, the main action is brand, the rest are neutral. */
	tone?: "brand" | "danger" | "neutral";
}

const ACTION_WIDTH = 88;
/**
 * A swipe starts only on a clearly sideways drag: 20 points across before 10
 * points up or down. Anything steeper fails the swipe and stays the list's
 * scroll, so a scroll that drifts never stops on a row's actions.
 */
export const SWIPE_START = 20;
export const SWIPE_FAIL_Y = 10;
/** A fling's share of where a released row lands. */
const TOSS = 0.05;

/** The one row whose actions are open: opening another closes it. */
let openRow: { close: () => void } | null = null;

type Side = "leading" | "trailing" | null;

/**
 * A row with swipe actions and their long-press twin. Every action that can
 * be swiped is also in `menu` (the native context menu on iOS, an M3
 * dropdown at the row on Android), which is also what a screen reader or a
 * hardware-keyboard user reaches. The row's own tap is `onPress`; while the
 * actions are open a tap closes them instead. Swipes follow the finger one to
 * one, do not overshoot, and settle in 200 with the land curve (reduced
 * motion: they settle at once). The actions are drawn only while the row is
 * moved, under an opaque row, so a selected row's tint never shows them.
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
	const theme = useTheme();
	const { color, duration, space } = theme;
	const rest = useInGroup() ? color.surface : color.bg;
	const x = useSharedValue(0);
	const from = useSharedValue(0);
	const [side, setSide] = useState<Side>(null);
	const [open, setOpen] = useState(false);
	const min = trailing ? -ACTION_WIDTH : 0;
	const max = leading ? ACTION_WIDTH : 0;
	const ease = useMemo(() => easeLand(theme), [theme]);

	const settle = useCallback(
		(to: number) => {
			"worklet";
			x.value = withTiming(to, {
				duration: duration.row,
				easing: ease,
				reduceMotion: ReduceMotion.System,
			});
		},
		[duration.row, ease, x],
	);

	const self = useRef({ close: () => {} });
	const opened = useCallback((now: boolean) => {
		setOpen(now);
		if (now) {
			if (openRow && openRow !== self.current) openRow.close();
			openRow = self.current;
		} else if (openRow === self.current) {
			openRow = null;
		}
	}, []);
	const shut = useCallback(() => {
		settle(0);
		opened(false);
	}, [opened, settle]);
	self.current.close = shut;

	// A tab switch closes an open row (transient UI).
	useTransient(open ? shut : null);
	useEffect(
		() => () => {
			if (openRow === self.current) openRow = null;
		},
		[],
	);

	// The actions are drawn only while the row is off its rest.
	useAnimatedReaction(
		() => (x.value > 0 ? 1 : x.value < 0 ? -1 : 0),
		(now, before) => {
			if (now !== before) {
				scheduleOnRN(
					setSide,
					now > 0 ? "leading" : now < 0 ? "trailing" : null,
				);
			}
		},
	);

	const startDrag = useCallback(() => {
		if (openRow && openRow !== self.current) openRow.close();
	}, []);

	const pan = usePanGesture(
		useMemo(
			() => ({
				enabled: max > 0 || min < 0,
				activeOffsetX: [-SWIPE_START, SWIPE_START] as [number, number],
				failOffsetY: [-SWIPE_FAIL_Y, SWIPE_FAIL_Y] as [number, number],
				onActivate: () => {
					"worklet";
					from.value = x.value;
					scheduleOnRN(startDrag);
				},
				onUpdate: (event: { translationX: number }) => {
					"worklet";
					// The drag starts where the finger crossed the start distance,
					// so the row does not jump by it.
					const pull =
						event.translationX > 0
							? event.translationX - SWIPE_START
							: event.translationX + SWIPE_START;
					x.value = Math.min(max, Math.max(min, from.value + pull));
				},
				onDeactivate: (event: { velocityX: number }) => {
					"worklet";
					const landing = x.value + TOSS * event.velocityX;
					const to =
						landing > ACTION_WIDTH / 2 && max > 0
							? max
							: landing < -ACTION_WIDTH / 2 && min < 0
								? min
								: 0;
					settle(to);
					scheduleOnRN(opened, to !== 0);
				},
			}),
			[from, max, min, opened, settle, startDrag, x],
		),
	);

	const moved = useAnimatedStyle(() => ({
		transform: [{ translateX: x.value }],
	}));

	const action = (a: SwipeAction, at: "left" | "right") => (
		<Pressable
			accessibilityRole="button"
			onPress={() => {
				shut();
				a.onPress();
			}}
			style={{
				position: "absolute",
				top: 0,
				bottom: 0,
				[at]: 0,
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
				style={{ color: a.tone === "danger" ? color.dangerFg : color.brandFg }}
				variant="small"
				weight="semibold"
			>
				{a.label}
			</Text>
		</Pressable>
	);

	return (
		<View style={{ overflow: "hidden" }}>
			{side === "leading" && leading ? action(leading, "left") : null}
			{side === "trailing" && trailing ? action(trailing, "right") : null}
			<GestureDetector gesture={pan}>
				<Animated.View style={[{ backgroundColor: rest }, moved]}>
					<RowMenu items={menu} onPress={onPress} title={menuTitle}>
						{children}
					</RowMenu>
					{open ? (
						// While the actions show, a tap on the row only closes them.
						<Pressable
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
							onPress={shut}
							style={StyleSheet.absoluteFill}
						/>
					) : null}
				</Animated.View>
			</GestureDetector>
		</View>
	);
}
