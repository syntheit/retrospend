import {
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	FlatList,
	type FlatListProps,
	type LayoutChangeEvent,
	Platform,
	ScrollView,
	type ScrollViewProps,
	SectionList,
	type SectionListProps,
	StyleSheet,
	useWindowDimensions,
} from "react-native";
import Animated, {
	runOnUI,
	type SharedValue,
	scrollTo,
	useAnimatedRef,
	useScrollOffset,
	useSharedValue,
} from "react-native-reanimated";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { RetrospendPredictiveBack } from "../../modules/predictive-back";
import { scrollActive } from "./hostQueue";
import { useScrollToTopTarget } from "./scrollToTop";
import { TEXT_SCALE_CAP } from "./Text";

/**
 * Android's collapsing large top app bar (Material 3) is drawn over the
 * screen, not by the navigator, so the lists of a tab root report their
 * scroll offset to it and leave room for it. The pieces:
 *
 * - `CollapsingBarProvider` wraps a tab root's screen (TabStack). Only there
 *   does the context exist, so pushed pages and iOS keep the plain lists.
 * - `BarScrollView`, `BarFlatList` and `BarSectionList` are the scroll
 *   containers. Outside the provider they are the React Native components;
 *   inside, they pad the top by the bar's expanded height and write the
 *   offset to the shared value on the UI thread (no timed animation: the bar
 *   follows the finger).
 * - `useBarMetrics` is the one place the bar's heights are worked out.
 */
interface BarState {
	/** The scroll offset of the screen's list, written on the UI thread. */
	offset: SharedValue<number>;
	/** Extra height pinned under the bar that does not scroll (People's tabs). */
	footer: number;
}

const BarContext = createContext<BarState | null>(null);

/** The bar of this screen, or null where the plain bar applies (iOS, pushed pages, a wide pair). */
export function useCollapsingBar(): BarState | null {
	return useContext(BarContext);
}

export function CollapsingBarProvider({
	footer = 0,
	children,
}: {
	footer?: number;
	children: ReactNode;
}) {
	const offset = useSharedValue(0);
	const value = useMemo(() => ({ offset, footer }), [offset, footer]);
	return <BarContext.Provider value={value}>{children}</BarContext.Provider>;
}

/** Lists inside the expanded search view are not under the bar: they get the plain containers. */
export function NoBar({ children }: { children: ReactNode }) {
	return <BarContext.Provider value={null}>{children}</BarContext.Provider>;
}

export interface BarMetrics {
	/** The status bar. */
	inset: number;
	/** The small bar: 56 under the status bar. */
	row: number;
	/** The large title's band under the row; the distance the bar collapses over. */
	large: number;
	/** The large title's line height at the user's text size. */
	titleLine: number;
	/** Inset and row: where the bar rests once collapsed, with the pinned footer. */
	collapsed: number;
	/** The whole bar at rest: what a list leaves empty above its first row. */
	expanded: number;
}

/**
 * The bar's heights from tokens. The title line grows with the user's text
 * size up to the chrome cap (the title is a Text at that cap), and the band
 * follows it, so nothing clips at the largest size.
 */
export function useBarMetrics(footer = 0): BarMetrics {
	const { space, type } = useTheme();
	const { fontScale } = useWindowDimensions();
	// The context, not the hook: Screen asks for the inset on every page, and
	// the hook throws where no provider is mounted (tests, the gallery).
	const top = useContext(SafeAreaInsetsContext)?.top ?? 0;
	const scale = Math.min(Math.max(fontScale, 1), TEXT_SCALE_CAP.chrome);
	const row = space[12] + space[2];
	const titleLine = Math.round(type.hero.size * type.hero.lineHeight * scale);
	const large = space[2] + titleLine + space[3];
	return {
		inset: top,
		row,
		large,
		titleLine,
		collapsed: top + row + footer,
		expanded: top + row + large + footer,
	};
}

/** The empty band a list leaves above its rows for the bar; 0 without a bar. */
export function useBarInset(): number {
	const bar = useCollapsingBar();
	const metrics = useBarMetrics(bar?.footer ?? 0);
	return bar ? metrics.expanded : 0;
}

const AnimatedFlatList = Animated.FlatList as unknown as ComponentType<
	FlatListProps<unknown>
>;

const AnimatedSectionList = Animated.createAnimatedComponent(
	SectionList,
) as unknown as ComponentType<SectionListProps<unknown, unknown>>;

/** The container's own top padding, so the bar's band comes on top of it. */
function paddedTop(
	style: ScrollViewProps["contentContainerStyle"],
	by: number,
) {
	const flat = StyleSheet.flatten(style) ?? {};
	const own =
		typeof flat.paddingTop === "number"
			? flat.paddingTop
			: typeof flat.padding === "number"
				? flat.padding
				: 0;
	return [style, { paddingTop: own + by }];
}

function useTracked(bar: BarState) {
	const metrics = useBarMetrics(bar.footer);
	// biome-ignore lint/suspicious/noExplicitAny: one ref for three list kinds
	const ref = useAnimatedRef<any>();
	useScrollOffset(ref, bar.offset);
	// Tapping the open tab again goes back to the top (the offset follows, so
	// the title expands again).
	useScrollToTopTarget(() => {
		runOnUI(() => {
			"worklet";
			scrollTo(ref, 0, 0, true);
		})();
	});
	return { ref, by: metrics.expanded };
}

function TrackedScrollView({
	bar,
	...props
}: ScrollViewProps & { bar: BarState }) {
	const { ref, by } = useTracked(bar);
	return (
		<Animated.ScrollView
			{...props}
			contentContainerStyle={paddedTop(props.contentContainerStyle, by)}
			ref={ref}
		/>
	);
}

/**
 * Android only: lets a list hand its drag to the sheet around it. A modal
 * bottom sheet (the account sheet) closes on a downward drag of the body once
 * the list is at the top; that is nested scrolling, which a React Native list
 * takes part in only when it asks for it. A list whose content fits does not
 * scroll, takes no touch of its own and so must not be the sheet's scrolling
 * child: the sheet then drags from anywhere in its body. So the list asks for
 * nested scrolling only while its content is taller than it is. Elsewhere
 * nothing is nested, so it changes nothing; iOS draws its own sheet and the
 * props are left alone.
 */
/** A scroll's begin and end tell the host queue to hold off (hostQueue). */
function gated<
	P extends {
		onScrollBeginDrag?: (e: never) => void;
		onScrollEndDrag?: (e: never) => void;
		onMomentumScrollBegin?: (e: never) => void;
		onMomentumScrollEnd?: (e: never) => void;
	},
>(props: P): P {
	const wrap = (on: boolean, inner?: (e: never) => void) => (e: never) => {
		scrollActive(on);
		inner?.(e);
	};
	return {
		...props,
		onScrollBeginDrag: wrap(true, props.onScrollBeginDrag),
		// A drag that ends may coast: the momentum begin keeps it active.
		onScrollEndDrag: wrap(false, props.onScrollEndDrag),
		onMomentumScrollBegin: wrap(true, props.onMomentumScrollBegin),
		onMomentumScrollEnd: wrap(false, props.onMomentumScrollEnd),
	};
}

function useSheetHandoff<
	P extends {
		onLayout?: (e: LayoutChangeEvent) => void;
		onContentSizeChange?: (w: number, h: number) => void;
	},
>(raw: P): P {
	const props = gated(raw as never) as P;
	const [nested, setNested] = useState(false);
	const size = useRef({ view: 0, content: 0 });
	const first = useRef(true);
	const android = Platform.OS === "android";
	// The sheet picks its scrolling child when it lays out; tell it again when
	// the answer changes.
	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		if (android) RetrospendPredictiveBack?.refreshSheetScroll();
	}, [nested, android]);
	if (!android) return props;
	const check = () => setNested(size.current.content > size.current.view + 1);
	return {
		...props,
		nestedScrollEnabled: nested,
		onLayout: (e: LayoutChangeEvent) => {
			size.current.view = e.nativeEvent.layout.height;
			check();
			props.onLayout?.(e);
		},
		onContentSizeChange: (w: number, h: number) => {
			size.current.content = h;
			check();
			props.onContentSizeChange?.(w, h);
		},
	};
}

/** A ScrollView that drives the collapsing bar of its screen, if it has one. */
export function BarScrollView(props: ScrollViewProps) {
	const bar = useCollapsingBar();
	const merged = useSheetHandoff(props);
	if (!bar) return <ScrollView {...merged} />;
	return <TrackedScrollView {...merged} bar={bar} />;
}

function TrackedFlatList<T>({
	bar,
	...props
}: FlatListProps<T> & { bar: BarState }) {
	const { ref, by } = useTracked(bar);
	return (
		<AnimatedFlatList
			{...(props as FlatListProps<unknown>)}
			contentContainerStyle={paddedTop(props.contentContainerStyle, by)}
			progressViewOffset={by}
			// biome-ignore lint/suspicious/noExplicitAny: the animated wrapper's ref
			{...({ ref } as any)}
		/>
	);
}

/** A FlatList that drives the collapsing bar of its screen, if it has one. */
export function BarFlatList<T>(props: FlatListProps<T>) {
	const bar = useCollapsingBar();
	const merged = useSheetHandoff(props);
	if (!bar) return <FlatList {...merged} />;
	return <TrackedFlatList {...merged} bar={bar} />;
}

function TrackedSectionList<T, S>({
	bar,
	...props
}: SectionListProps<T, S> & { bar: BarState }) {
	const { ref, by } = useTracked(bar);
	return (
		<AnimatedSectionList
			{...(props as SectionListProps<unknown, unknown>)}
			contentContainerStyle={paddedTop(props.contentContainerStyle, by)}
			progressViewOffset={by}
			// biome-ignore lint/suspicious/noExplicitAny: the animated wrapper's ref
			{...({ ref } as any)}
		/>
	);
}

/** A SectionList that drives the collapsing bar of its screen, if it has one. */
export function BarSectionList<T, S>(props: SectionListProps<T, S>) {
	const bar = useCollapsingBar();
	const merged = useSheetHandoff(props);
	if (!bar) return <SectionList {...merged} />;
	return <TrackedSectionList {...merged} bar={bar} />;
}
