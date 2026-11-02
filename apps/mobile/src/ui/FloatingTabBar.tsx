import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "./Glyph";
import { easeLand } from "./motion";
import { scrollFocusedToTop } from "./scrollToTop";
import { Text } from "./Text";
import { floatingBarMetrics } from "./tabBarMetrics";
import { useKeyboardShown } from "./useKeyboardShown";

export interface FloatingTab {
	/** The route name under app/(tabs). */
	name: string;
	label: string;
	glyph: GlyphName;
}

/** The slice of the tabs navigator's bar props the bar reads. */
export interface FloatingTabBarProps {
	tabs: readonly FloatingTab[];
	state: {
		index: number;
		routes: readonly {
			key: string;
			name: string;
			state?: { index?: number } | undefined;
		}[];
	};
	emitter: {
		emit: (event: {
			type: "tabPress";
			target: string;
			canPreventDefault: true;
		}) => { defaultPrevented?: boolean } | undefined;
	};
	navigateToTab: (routeKey: string) => void;
	insets: { bottom: number };
}

/**
 * PROVISIONAL (owner option A of android-navbar-r2): the Android bottom bar.
 * A floating pill inset from the sides and above the gesture area, in the
 * raised surface with a hairline (no glass, blur or shadow), five equal tabs
 * with the icon over the label. The open tab sits in one lozenge around the
 * whole tab, brand-soft with a brand icon and label; it slides to the tab
 * you press (220, the land curve, no overshoot), and with reduced motion it
 * jumps. A press on the open tab emits `tabPress`, which pops its stack to
 * the root; at the root it scrolls the list to the top. The bar steps aside
 * while the keyboard is up. Labels truncate at large text sizes, never
 * overlap. A screen reader hears a tab list with the open tab selected.
 */
export function FloatingTabBar({
	tabs,
	state,
	emitter,
	navigateToTab,
	insets,
}: FloatingTabBarProps) {
	const theme = useTheme();
	const { color, duration, radius, space } = theme;
	const bar = floatingBarMetrics(theme);
	const reduce = useReducedMotion();
	const ease = useMemo(() => easeLand(theme), [theme]);
	const keyboard = useKeyboardShown();
	const [width, setWidth] = useState(0);
	const tabWidth = width / tabs.length;

	const focusedName = state.routes[state.index]?.name;
	const open = tabs.findIndex((tab) => tab.name === focusedName);

	const x = useSharedValue(0);
	const shown = useSharedValue(0);
	const placed = useRef(false);

	useEffect(() => {
		if (tabWidth === 0) return;
		const target = Math.max(open, 0) * tabWidth;
		const visible = open >= 0 ? 1 : 0;
		if (!placed.current || reduce) {
			// The first layout and reduced motion: no slide, the lozenge is there.
			placed.current = true;
			x.value = target;
			shown.value = visible;
			return;
		}
		shown.value = withTiming(visible, { duration: duration.state });
		if (open >= 0) {
			x.value = withTiming(target, { duration: duration.tab, easing: ease });
		}
	}, [open, tabWidth, reduce, duration.state, duration.tab, ease, shown, x]);

	const lozenge = useAnimatedStyle(() => ({
		opacity: shown.value,
		width: tabWidth,
		transform: [{ translateX: x.value }],
	}));

	if (keyboard) return null;

	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				left: bar.sideGap,
				right: bar.sideGap,
				bottom: insets.bottom + bar.bottomGap,
			}}
		>
			<View
				accessibilityRole="tablist"
				style={{
					height: bar.height,
					padding: bar.padding,
					borderRadius: radius.chip,
					borderWidth: bar.border,
					borderColor: color.line,
					backgroundColor: color.raised,
				}}
			>
				<View
					onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
					style={{ flex: 1, flexDirection: "row" }}
				>
					<Animated.View
						pointerEvents="none"
						style={[
							{
								position: "absolute",
								left: 0,
								top: 0,
								height: bar.tab,
								borderRadius: radius.chip,
								backgroundColor: color.brandSoft,
							},
							lozenge,
						]}
					/>
					{tabs.map((tab, index) => {
						const route = state.routes.find((r) => r.name === tab.name);
						const on = index === open;
						const tone = on ? color.brand : color.fg2;
						return (
							<Pressable
								accessibilityLabel={tab.label}
								accessibilityRole="tab"
								accessibilityState={{ selected: on }}
								key={tab.name}
								onPress={() => {
									if (!route) return;
									const event = emitter.emit({
										type: "tabPress",
										target: route.key,
										canPreventDefault: true,
									});
									if (event?.defaultPrevented) return;
									if (!on) navigateToTab(route.key);
									// Open already: the stack pops to its root (the event);
									// at the root, the list goes to the top.
									else if ((route.state?.index ?? 0) === 0)
										scrollFocusedToTop();
								}}
								style={{
									flex: 1,
									minWidth: 0,
									height: bar.tab,
									alignItems: "center",
									justifyContent: "center",
									gap: space[1] / 2,
									paddingHorizontal: space[1],
									borderRadius: radius.chip,
								}}
							>
								<Glyph color={tone} name={tab.glyph} size={space[6]} />
								<Text
									numberOfLines={1}
									scale="chrome"
									style={{ color: tone }}
									variant="meta"
									weight={on ? "semibold" : "medium"}
								>
									{tab.label}
								</Text>
							</Pressable>
						);
					})}
				</View>
			</View>
		</View>
	);
}
