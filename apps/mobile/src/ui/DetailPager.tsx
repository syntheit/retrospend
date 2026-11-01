import {
	Children,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type LayoutChangeEvent,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import {
	GestureDetector,
	GestureHandlerRootView,
	usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
	ReduceMotion,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "./Glyph";
import { easeLand } from "./motion";
import { Text } from "./Text";

/** One tab of the pager: its word, its glyph, and whether it is off its default. */
export interface PagerTab {
	key: string;
	label: string;
	icon: GlyphName;
	/** A small accent dot: this answer is not at its default. */
	dot?: boolean;
}

/** Below this width the tabs are icons only, each with its spoken label. */
export const ICON_ONLY_WIDTH = 340;
/** At this text size and above the tabs are icons only. */
export const ICON_ONLY_SCALE = 1.5;
/** The least height a panel keeps; it scrolls inside. */
export const MIN_PANEL_HEIGHT = 140;

/**
 * A swipe starts after 12 points sideways before 12 up or down: anything
 * steeper stays the panel's own vertical scroll.
 */
export const PAGER_START = 12;
export const PAGER_FAIL_Y = 12;
/** How far ahead of the finger a fling carries the release point, in seconds. */
const TOSS_SECONDS = 0.12;

/**
 * The page a released drag settles on: the one nearest the release point once
 * the finger's velocity has carried it a little further (a short, fast flick
 * turns the page), never more than one page from where the drag began, and
 * never past the ends. `offset` is the strip's translation (0 at the first
 * page, negative after), `velocity` the finger's, in points per second.
 */
export function settlePage(
	offset: number,
	velocity: number,
	width: number,
	count: number,
	from: number,
): number {
	"worklet";
	if (width <= 0) return from;
	const landing = Math.round(-(offset + velocity * TOSS_SECONDS) / width);
	const near = Math.min(from + 1, Math.max(from - 1, landing));
	return Math.min(count - 1, Math.max(0, near));
}

/**
 * Where the strip sits while the finger drags: the strip as it was when the
 * drag took hold plus how far the finger moved past the start distance (so the
 * strip does not jump by it), held between the first and the last page. No
 * rubber band and no overshoot.
 */
export function followOffset(
	from: number,
	translation: number,
	width: number,
	count: number,
): number {
	"worklet";
	const pull =
		translation > 0 ? translation - PAGER_START : translation + PAGER_START;
	const drag = Math.abs(translation) < PAGER_START ? 0 : pull;
	return Math.max(-(count - 1) * width, Math.min(0, from + drag));
}

/**
 * The details of an entry as one row of tabs over a pager. The tabs are a
 * fixed grid of equal icon-plus-word buttons (icons only on a narrow phone or
 * at the largest text sizes); the open one has the brand-soft fill and a
 * heavier word. Under them each tab has a panel, side by side on a strip that
 * follows the finger one to one while it drags and settles on release in the
 * tab duration (velocity aware, interruptible by a new touch, no overshoot).
 * A tab press slides the strip the same way; reduced motion: it jumps. Every
 * panel scrolls inside its own height, so no control is cut on a short phone.
 * The page is owned by the caller: `onPageChange` says which one the person
 * asked for and how.
 */
export function DetailPager({
	tabs,
	page,
	onPageChange,
	children,
	label,
	dotLabel,
	minHeight = MIN_PANEL_HEIGHT,
}: {
	tabs: PagerTab[];
	page: number;
	onPageChange: (page: number, by: "tab" | "swipe") => void;
	/** One panel per tab, in order. */
	children: ReactNode;
	/** The tab list's spoken name ("Details"). */
	label: string;
	/** Added to a dotted tab's spoken label ("changed"). */
	dotLabel: string;
	minHeight?: number;
}) {
	const theme = useTheme();
	const { color, duration, radius, size, space } = theme;
	const { fontScale, width: windowWidth } = useWindowDimensions();
	const reduce = useReducedMotion();
	const [box, setBox] = useState({ width: 0, height: 0 });
	const { width } = box;
	// Before the first layout the window's width stands in, so every panel exists.
	const pageWidth = Math.round(width || windowWidth);
	const iconsOnly = pageWidth < ICON_ONLY_WIDTH || fontScale >= ICON_ONLY_SCALE;
	const panels = Children.toArray(children);
	const count = panels.length;
	const ease = useMemo(() => easeLand(theme), [theme]);

	// The strip's translation, and the facts the drag's worklets read.
	const x = useSharedValue(-page * pageWidth);
	const from = useSharedValue(0);
	const widthSV = useSharedValue(pageWidth);
	const countSV = useSharedValue(count);
	const shown = useRef(page);

	const slide = useCallback(
		(to: number) => {
			"worklet";
			x.value = withTiming(to, {
				duration: duration.tab,
				easing: ease,
				reduceMotion: ReduceMotion.System,
			});
		},
		[duration.tab, ease, x],
	);

	// The caller moved the page (a tab, a part of the summary line): the strip
	// follows from wherever it is. A width change (rotation, a split view)
	// lands on the page at once.
	const lastWidth = useRef(pageWidth);
	useEffect(() => {
		const resized = lastWidth.current !== pageWidth;
		lastWidth.current = pageWidth;
		widthSV.value = pageWidth;
		countSV.value = count;
		if (resized) {
			x.value = -page * pageWidth;
			shown.current = page;
		} else if (shown.current !== page) {
			shown.current = page;
			slide(-page * pageWidth);
		}
	}, [page, pageWidth, count, slide, widthSV, countSV, x]);

	const settled = useCallback(
		(next: number) => {
			if (next === shown.current) return;
			shown.current = next;
			onPageChange(next, "swipe");
		},
		[onPageChange],
	);

	const pan = usePanGesture(
		useMemo(
			() => ({
				enabled: count > 1,
				activeOffsetX: [-PAGER_START, PAGER_START] as [number, number],
				failOffsetY: [-PAGER_FAIL_Y, PAGER_FAIL_Y] as [number, number],
				onActivate: () => {
					"worklet";
					// A drag that catches the strip mid-slide takes it from where it is.
					from.value = x.value;
				},
				onUpdate: (event: { translationX: number }) => {
					"worklet";
					x.value = followOffset(
						from.value,
						event.translationX,
						widthSV.value,
						countSV.value,
					);
				},
				onDeactivate: (event: { velocityX: number }) => {
					"worklet";
					const began = Math.round(-from.value / Math.max(widthSV.value, 1));
					const next = settlePage(
						x.value,
						event.velocityX,
						widthSV.value,
						countSV.value,
						began,
					);
					slide(-next * widthSV.value);
					scheduleOnRN(settled, next);
				},
			}),
			[count, countSV, from, settled, slide, widthSV, x],
		),
	);

	const strip = useAnimatedStyle(() => ({
		transform: [{ translateX: x.value }],
	}));

	const dot = space[2];
	return (
		<View style={{ flex: 1, minHeight, gap: space[2] }}>
			<View
				accessibilityLabel={label}
				accessibilityRole="tablist"
				style={{
					flexDirection: "row",
					gap: space[1],
					paddingHorizontal: space[2],
				}}
			>
				{tabs.map((tab, index) => {
					const on = index === page;
					const spoken = tab.dot ? `${tab.label}, ${dotLabel}` : tab.label;
					return (
						<Pressable
							accessibilityLabel={spoken}
							accessibilityRole="tab"
							accessibilityState={{ selected: on }}
							key={tab.key}
							onPress={() => onPageChange(index, "tab")}
							style={({ pressed }) => ({
								flex: 1,
								minWidth: 0,
								minHeight: size.touchMin.phone + space[1],
								alignItems: "center",
								justifyContent: "center",
								gap: space[1],
								borderRadius: radius.panel,
								backgroundColor: on
									? color.brandSoft
									: pressed
										? color.raised
										: "transparent",
							})}
						>
							<View>
								<Glyph
									color={on ? color.brand : color.fg3}
									name={tab.icon}
									size={size.icon.phone}
								/>
								{tab.dot ? (
									<View
										style={{
											position: "absolute",
											top: -space[1],
											right: -space[2],
											width: dot,
											height: dot,
											borderRadius: dot / 2,
											backgroundColor: color.accent,
											borderWidth: space[1] / 2,
											borderColor: color.bg,
										}}
									/>
								) : null}
							</View>
							{iconsOnly ? null : (
								<Text
									numberOfLines={1}
									scale="chrome"
									tone={on ? "fg" : "fg3"}
									variant="meta"
									weight={on ? "semibold" : "normal"}
								>
									{tab.label}
								</Text>
							)}
						</Pressable>
					);
				})}
			</View>
			<View
				style={{
					flex: 1,
					minHeight: minHeight - size.touchMin.phone,
				}}
			>
				{/* A sheet or modal hosts its own native tree: the gesture root goes inside it. */}
				<GestureHandlerRootView style={{ flex: 1 }}>
					<View
						onLayout={(event: LayoutChangeEvent) => {
							const { width: w, height: h } = event.nativeEvent.layout;
							setBox((b) =>
								b.width === w && b.height === h ? b : { width: w, height: h },
							);
						}}
						style={{ flex: 1, overflow: "hidden" }}
					>
						<GestureDetector gesture={pan}>
							<Animated.View
								style={[
									{
										flexDirection: "row",
										width: pageWidth * count,
										height: box.height || undefined,
									},
									strip,
								]}
							>
								{panels.map((panel, index) => (
									<View
										accessibilityElementsHidden={index !== page}
										importantForAccessibility={
											index === page ? "auto" : "no-hide-descendants"
										}
										// biome-ignore lint/suspicious/noArrayIndexKey: the panels are fixed, one per tab
										key={index}
										style={{ width: pageWidth, height: box.height || undefined }}
									>
										<ScrollView
											contentContainerStyle={{
												padding: space[3],
												gap: space[2],
												flexGrow: 1,
											}}
											keyboardShouldPersistTaps="handled"
											nestedScrollEnabled
										>
											{panel}
										</ScrollView>
									</View>
								))}
							</Animated.View>
						</GestureDetector>
					</View>
				</GestureHandlerRootView>
			</View>
		</View>
	);
}
