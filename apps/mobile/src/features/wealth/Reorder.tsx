import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	cancelAnimation,
	type SharedValue,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { LAYER } from "@/ui/metrics";

/** How long the grip is held before the row lifts, so a swipe past it still scrolls. */
const HOLD_MS = 180;

let haptics: Promise<typeof import("expo-haptics") | null> | null = null;

/** One light tick when a row lifts; silent when the native module is missing. */
function tick() {
	haptics ??= import("expo-haptics").catch(() => null);
	haptics.then((module) => module?.selectionAsync()).catch(() => undefined);
}

interface ReorderState {
	/** Index of the row being dragged, -1 when none. */
	active: SharedValue<number>;
	/** Index the dragged row would land on now. */
	over: SharedValue<number>;
	/** The finger's travel, clamped to the group. */
	dragY: SharedValue<number>;
	/** Height of the dragged row, which the others make room for. */
	rowH: SharedValue<number>;
	heights: RefObject<number[]>;
	count: number;
	duration: number;
	begin: (index: number) => void;
	drag: (index: number, translationY: number) => void;
	finish: (index: number) => void;
	step: (index: number, delta: number) => void;
}

const Reorder = createContext<ReorderState | null>(null);

export type WrapRow = (props: {
	index: number;
	children: ReactNode;
}) => ReactNode;

/**
 * Drag to reorder one group of rows (Custom sort only). Hold a row's grip
 * and drag: the row follows the finger, the others make room (200, a jump
 * under reduced motion) and the new order is handed to `onMove` on release.
 * A screen reader moves a row with the grip's adjust actions instead.
 * `children` draws the group and takes the wrapper for each of its rows.
 */
export function ReorderGroup({
	ids,
	onMove,
	children,
}: {
	/** The ids of the rows, in the order they are drawn. */
	ids: readonly string[];
	/** The row at `from` now sits at `to`. */
	onMove: (from: number, to: number) => void;
	children: (wrapRow: WrapRow) => ReactNode;
}) {
	const { duration, space } = useTheme();
	// The row height assumed until a row has been measured.
	const fallbackHeight = space[12] + space[2];
	const reduced = useReducedMotion();
	const settle = reduced ? 0 : duration.row;
	const active = useSharedValue(-1);
	const over = useSharedValue(-1);
	const dragY = useSharedValue(0);
	const rowH = useSharedValue(fallbackHeight);
	const heights = useRef<number[]>([]);
	const count = ids.length;
	const key = ids.join("|");

	// A new order is on screen: the rows sit where they belong, so the lift is undone.
	// biome-ignore lint/correctness/useExhaustiveDependencies: key is the order itself
	useLayoutEffect(() => {
		cancelAnimation(dragY);
		active.value = -1;
		over.value = -1;
		dragY.value = 0;
	}, [key, active, over, dragY]);

	const state = useMemo<ReorderState>(() => {
		const clamp = (n: number) => Math.max(0, Math.min(count - 1, n));
		return {
			active,
			over,
			dragY,
			rowH,
			heights,
			count,
			duration: settle,
			begin: (index) => {
				tick();
				cancelAnimation(dragY);
				rowH.value = heights.current[index] ?? fallbackHeight;
				dragY.value = 0;
				over.value = index;
				active.value = index;
			},
			drag: (index, translationY) => {
				if (active.value !== index) return;
				const h = rowH.value;
				const y = Math.max(
					-index * h,
					Math.min((count - 1 - index) * h, translationY),
				);
				dragY.value = y;
				over.value = clamp(index + Math.round(y / h));
			},
			finish: (index) => {
				if (active.value !== index) return;
				const to = over.value;
				const done = () => {
					if (to === index) {
						active.value = -1;
						over.value = -1;
						dragY.value = 0;
					} else onMove(index, to);
				};
				if (settle === 0) return done();
				dragY.value = withTiming((to - index) * rowH.value, {
					duration: settle,
				});
				setTimeout(done, settle);
			},
			step: (index, delta) => {
				const to = clamp(index + delta);
				if (to !== index) onMove(index, to);
			},
		};
	}, [active, over, dragY, rowH, count, settle, onMove, fallbackHeight]);

	const wrapRow = useCallback<WrapRow>(
		({ index, children: row }) => <Wrap index={index}>{row}</Wrap>,
		[],
	);
	return <Reorder.Provider value={state}>{children(wrapRow)}</Reorder.Provider>;
}

function useReorder(): ReorderState {
	const state = useContext(Reorder);
	if (!state) throw new Error("ReorderGrip needs a ReorderGroup");
	return state;
}

/** One row's wrapper: it follows the finger while lifted, makes room while another is. */
function Wrap({ index, children }: { index: number; children: ReactNode }) {
	const s = useReorder();
	const { color } = useTheme();
	const style = useAnimatedStyle(() => {
		const a = s.active.value;
		if (a < 0) return { transform: [{ translateY: 0 }], zIndex: LAYER.base };
		if (a === index)
			return {
				transform: [{ translateY: s.dragY.value }],
				zIndex: LAYER.lift,
				backgroundColor: color.raised,
			};
		const o = s.over.value;
		const h = s.rowH.value;
		const y = a < index && index <= o ? -h : o <= index && index < a ? h : 0;
		return {
			transform: [{ translateY: withTiming(y, { duration: s.duration }) }],
			zIndex: LAYER.base,
		};
	});
	return (
		<Animated.View
			onLayout={(event) => {
				if (s.heights.current)
					s.heights.current[index] = event.nativeEvent.layout.height;
			}}
			style={style}
		>
			{children}
		</Animated.View>
	);
}

/**
 * The grip at the start of a row: hold and drag to move the row. For a screen
 * reader it is one adjustable element that moves the row up or down.
 */
export function ReorderGrip({ index, name }: { index: number; name: string }) {
	const s = useReorder();
	const t = useTranslations("mobile.wealth.sort");
	const { color, size } = useTheme();
	const pan = Gesture.Pan()
		.runOnJS(true)
		.activateAfterLongPress(HOLD_MS)
		.onStart(() => s.begin(index))
		.onUpdate((e) => s.drag(index, e.translationY))
		.onFinalize(() => s.finish(index));
	return (
		<GestureDetector gesture={pan}>
			<View
				accessibilityActions={[
					{ name: "increment", label: t("down") },
					{ name: "decrement", label: t("up") },
				]}
				accessibilityLabel={t("reorder", { name })}
				accessibilityRole="adjustable"
				accessibilityValue={{
					text: t("position", { position: index + 1, count: s.count }),
				}}
				accessible
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "increment") s.step(index, 1);
					if (event.nativeEvent.actionName === "decrement") s.step(index, -1);
				}}
				style={{
					width: size.touchMin.phone,
					height: size.touchMin.phone,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Glyph color={color.fg3} name="GripVertical" size={size.icon.phone} />
			</View>
		</GestureDetector>
	);
}
