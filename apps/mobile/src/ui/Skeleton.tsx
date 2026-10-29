import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	Animated,
	type DimensionValue,
	Easing,
	View,
} from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { ListGroup } from "./List";

type Shape = "line" | "tile" | "face" | "money";

/** One pulse: the fill fades to half and back, opacity only (GUIDELINE §11). */
const PULSE_MS = 700;

/**
 * Pulsing opacity shared by a set of placeholders. With reduced motion on,
 * the placeholders hold still.
 */
function usePulse(): Animated.Value {
	const opacity = useRef(new Animated.Value(1)).current;
	const [still, setStill] = useState(true);
	useEffect(() => {
		let live = true;
		AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
			if (live) setStill(reduce);
		});
		const sub = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setStill,
		);
		return () => {
			live = false;
			sub.remove();
		};
	}, []);
	useEffect(() => {
		if (still) {
			opacity.setValue(1);
			return;
		}
		const ease = Easing.inOut(Easing.ease);
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, {
					toValue: 0.5,
					duration: PULSE_MS,
					easing: ease,
					useNativeDriver: true,
				}),
				Animated.timing(opacity, {
					toValue: 1,
					duration: PULSE_MS,
					easing: ease,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [opacity, still]);
	return opacity;
}

/**
 * A placeholder in the shape of what is loading, on the raised fill: `line`
 * one line of text, `tile` the 32 row lead, `face` an avatar, `money` an
 * amount. It hides from screen readers; the list around it says it loads.
 */
export function Skeleton({
	shape,
	width,
}: {
	shape: Shape;
	/** A line's width ("50%") when it should not fill the row. */
	width?: DimensionValue;
}) {
	return <Block opacity={usePulse()} shape={shape} width={width} />;
}

/** One placeholder on a pulse that a set of them shares. */
function Block({
	shape,
	width,
	opacity,
}: {
	shape: Shape;
	width?: DimensionValue;
	opacity: Animated.Value;
}) {
	const { color, radius, size, space } = useTheme();
	const box =
		shape === "tile"
			? {
					width: size.avatar.default,
					height: size.avatar.default,
					borderRadius: radius.ctl,
				}
			: shape === "face"
				? {
						width: size.avatar.default,
						height: size.avatar.default,
						borderRadius: radius.chip,
					}
				: shape === "money"
					? {
							width: space[12] + space[6],
							height: space[3],
							borderRadius: radius.chip,
						}
					: {
							width: width ?? "100%",
							height: space[3],
							borderRadius: radius.chip,
						};
	return (
		<Animated.View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[box, { backgroundColor: color.raised, opacity }]}
		/>
	);
}

/**
 * Loading rows in place (R14): the shape of a list row (lead, title and sub
 * line, money at the end) at row height, so nothing jumps when the data
 * arrives. Grouped by default, like the list it stands in for.
 */
export function SkeletonRows({
	count = 3,
	grouped = true,
}: {
	count?: number;
	grouped?: boolean;
}) {
	const t = useTranslations("mobile.list");
	const opacity = usePulse();
	const { color, size, space } = useTheme();
	const rows = Array.from({ length: count }, (_, index) => (
		<View
			// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
			key={index}
			style={{
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
				...(grouped
					? null
					: { borderBottomWidth: 1, borderBottomColor: color.line }),
			}}
		>
			<Block opacity={opacity} shape="tile" />
			<View style={{ flex: 1, gap: space[2] }}>
				<Block opacity={opacity} shape="line" width="50%" />
				<Block opacity={opacity} shape="line" width="33%" />
			</View>
			<Block opacity={opacity} shape="money" />
		</View>
	));
	return (
		<View
			accessibilityLabel={t("loading")}
			accessibilityRole="progressbar"
			accessibilityState={{ busy: true }}
			accessible
		>
			{grouped ? <ListGroup>{rows}</ListGroup> : rows}
		</View>
	);
}
