import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AccessibilityInfo,
	Animated,
	Easing,
	Pressable,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

export interface ToastOptions {
	/** "Expense added": object plus past participle (GUIDELINE §12). */
	message: string;
	/** Money actions end with Undo (R15). */
	undo?: { label: string; onUndo: () => void };
}

interface ToastApi {
	show(options: ToastOptions): void;
	dismiss(): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const UNDO_MS = 6000;
const PLAIN_MS = 4000;
/** Clears the tab bar; the toast floats above it. */
const TAB_BAR_CLEARANCE = 64;

/**
 * One toast at a time, bottom of the screen above the tab bar. It announces
 * itself to screen readers, lasts longer when it carries Undo, and fades
 * (moves only when reduced motion is off). Never animates money.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
	const { color, duration, radius, size, space, type } = useTheme();
	const insets = useSafeAreaInsets();
	const t = useTranslations("mobile.common");
	const [current, setCurrent] = useState<ToastOptions | null>(null);
	const progress = useRef(new Animated.Value(0)).current;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [reduceMotion, setReduceMotion] = useState(false);
	// A screen reader needs time to read the toast and reach Undo, so with one
	// on, a toast that carries Undo stays until it is used, replaced or
	// dismissed (the escape gesture or the "Dismiss" action).
	const screenReader = useRef(false);

	useEffect(() => {
		AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
		AccessibilityInfo.isScreenReaderEnabled().then((on) => {
			screenReader.current = on;
		});
		const subscription = AccessibilityInfo.addEventListener(
			"screenReaderChanged",
			(on) => {
				screenReader.current = on;
			},
		);
		return () => subscription.remove();
	}, []);

	const dismiss = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		Animated.timing(progress, {
			toValue: 0,
			duration: duration.state,
			easing: Easing.bezier(0.4, 0, 1, 1),
			useNativeDriver: true,
		}).start(() => setCurrent(null));
	}, [duration.state, progress]);

	const show = useCallback(
		(options: ToastOptions) => {
			if (timer.current) clearTimeout(timer.current);
			setCurrent(options);
			AccessibilityInfo.announceForAccessibility(options.message);
			Animated.timing(progress, {
				toValue: 1,
				duration: duration.sheet,
				easing: Easing.bezier(0.22, 1, 0.36, 1),
				useNativeDriver: true,
			}).start();
			if (options.undo && screenReader.current) return;
			timer.current = setTimeout(dismiss, options.undo ? UNDO_MS : PLAIN_MS);
		},
		[dismiss, duration.sheet, progress],
	);

	const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

	return (
		<ToastContext.Provider value={api}>
			{children}
			{current ? (
				<Animated.View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						left: space[4],
						right: space[4],
						bottom: insets.bottom + TAB_BAR_CLEARANCE,
						opacity: progress,
						transform: reduceMotion
							? []
							: [
									{
										translateY: progress.interpolate({
											inputRange: [0, 1],
											outputRange: [space[4], 0],
										}),
									},
								],
					}}
				>
					<View
						accessibilityActions={[{ name: "dismiss", label: t("dismiss") }]}
						accessibilityLiveRegion="polite"
						onAccessibilityAction={(event) => {
							if (event.nativeEvent.actionName === "dismiss") dismiss();
						}}
						onAccessibilityEscape={dismiss}
						style={{
							minHeight: size.touchMin.phone,
							flexDirection: "row",
							alignItems: "center",
							gap: space[3],
							paddingLeft: space[4],
							paddingRight: space[2],
							borderRadius: radius.panel,
							backgroundColor: color.fg,
						}}
					>
						<Text
							style={{
								flex: 1,
								color: color.bg,
								fontSize: type.body.size,
								paddingVertical: space[3],
							}}
						>
							{current.message}
						</Text>
						{current.undo ? (
							<Pressable
								accessibilityRole="button"
								onPress={() => {
									current.undo?.onUndo();
									dismiss();
								}}
								style={{
									minHeight: size.touchMin.phone,
									justifyContent: "center",
									paddingHorizontal: space[3],
								}}
							>
								<Text
									style={{
										color: color.accent,
										fontSize: type.body.size,
										fontWeight: "600",
									}}
								>
									{current.undo.label}
								</Text>
							</Pressable>
						) : null}
					</View>
				</Animated.View>
			) : null}
		</ToastContext.Provider>
	);
}

export function useToast(): ToastApi {
	const value = useContext(ToastContext);
	if (!value) throw new Error("useToast needs a ToastProvider above it");
	return value;
}
