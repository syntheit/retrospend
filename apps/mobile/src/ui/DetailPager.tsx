import {
	Children,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Pressable,
	ScrollView,
	type ScrollViewInstance,
	useWindowDimensions,
	View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "./Glyph";
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

/** Eases a number from `from` to `to` over `ms`, one call per frame; returns a stop function. */
function tween(
	from: number,
	to: number,
	ms: number,
	frame: (value: number) => void,
	done: () => void,
): () => void {
	const start = Date.now();
	let id = 0;
	let stopped = false;
	const step = () => {
		if (stopped) return;
		const t = Math.min(1, (Date.now() - start) / ms);
		// Ease out, no overshoot.
		const eased = 1 - (1 - t) ** 3;
		frame(from + (to - from) * eased);
		if (t >= 1) done();
		else id = requestAnimationFrame(step);
	};
	id = requestAnimationFrame(step);
	return () => {
		stopped = true;
		cancelAnimationFrame(id);
	};
}

/**
 * The details of an entry as one row of tabs over a pager. The tabs are a
 * fixed grid of equal icon-plus-word buttons (icons only on a narrow phone or
 * at the largest text sizes); the open one has the brand-soft fill and a
 * heavier word. Under them each tab has a panel, side by side: swipe across,
 * or pick a tab, and the pager snaps to it over the tab duration (reduced
 * motion: it jumps). Every panel scrolls inside its own height, so no control
 * is cut on a short phone. The page is owned by the caller: `onPageChange`
 * says which one the person asked for and how.
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
	const { color, duration, radius, size, space } = useTheme();
	const { fontScale, width: windowWidth } = useWindowDimensions();
	const reduce = useReducedMotion();
	const [box, setBox] = useState({ width: 0, height: 0 });
	const { width } = box;
	// Before the first layout the window's width stands in, so every panel exists.
	const pageWidth = Math.round(width || windowWidth);
	const iconsOnly = pageWidth < ICON_ONLY_WIDTH || fontScale >= ICON_ONLY_SCALE;
	const panels = Children.toArray(children);
	const scroller = useRef<ScrollViewInstance>(null);
	const offset = useRef(0);
	const shown = useRef(page);
	const stop = useRef<(() => void) | null>(null);

	const goTo = useCallback(
		(next: number, animate: boolean) => {
			stop.current?.();
			stop.current = null;
			const target = next * pageWidth;
			if (!animate || reduce || pageWidth === 0) {
				scroller.current?.scrollTo({ x: target, animated: false });
				offset.current = target;
				return;
			}
			stop.current = tween(
				offset.current,
				target,
				duration.tab,
				(x) => {
					scroller.current?.scrollTo({ x, animated: false });
					offset.current = x;
				},
				() => {
					stop.current = null;
				},
			);
		},
		[pageWidth, reduce, duration.tab],
	);

	// The caller moved the page (a tab, a summary part): the pager follows. A
	// width change (rotation, a split view) lands on the page at once.
	const lastWidth = useRef(pageWidth);
	useEffect(() => {
		const resized = lastWidth.current !== pageWidth;
		lastWidth.current = pageWidth;
		if (resized || shown.current !== page) {
			goTo(page, !resized && shown.current !== page);
			shown.current = page;
		}
	}, [page, pageWidth, goTo]);
	useEffect(() => () => stop.current?.(), []);

	function settled(event: NativeSyntheticEvent<NativeScrollEvent>) {
		// A scroll the pager started itself is not a swipe.
		if (pageWidth === 0 || stop.current) return;
		const x = event.nativeEvent.contentOffset.x;
		offset.current = x;
		const next = Math.max(
			0,
			Math.min(panels.length - 1, Math.round(x / pageWidth)),
		);
		if (next !== shown.current) {
			shown.current = next;
			onPageChange(next, "swipe");
		}
	}

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
					borderTopWidth: 1,
					borderBottomWidth: 1,
					borderColor: color.line,
				}}
			>
				<View
					onLayout={(event: LayoutChangeEvent) => {
						const { width: w, height: h } = event.nativeEvent.layout;
						setBox((b) =>
							b.width === w && b.height === h ? b : { width: w, height: h },
						);
					}}
					style={{ flex: 1 }}
				>
					<ScrollView
						horizontal
						nestedScrollEnabled
						onMomentumScrollEnd={settled}
						onScroll={(event) => {
							if (!stop.current)
								offset.current = event.nativeEvent.contentOffset.x;
						}}
						pagingEnabled
						ref={scroller}
						scrollEventThrottle={16}
						showsHorizontalScrollIndicator={false}
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
					</ScrollView>
				</View>
			</View>
		</View>
	);
}
