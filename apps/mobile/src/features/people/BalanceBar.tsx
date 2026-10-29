import { useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar, avatarSlot } from "@/ui/Avatar";
import { chartColors, seriesColor, THIN } from "@/ui/charts/chartSpec";
import { pinsOf, type Segment } from "./groups";
import type { PeopleOverview } from "./source";

/** The hatch of the you-owe segments, as on the web bar (6 pt cells, 2 pt stripes). */
const HATCH = { size: 6, stripe: 2 } as const;

const idOf = (s: Segment) => `${s.direction}-${s.key}`;

/**
 * Who makes up what you are owed and what you owe, as one two-sided bar,
 * ported from the web's standing bar. Owed segments take each person's
 * identity color, you-owe segments are hatched after a gap, and the biggest
 * have their face above them. A segment opens that person.
 */
export function BalanceBar({
	overview,
	onPerson,
}: {
	overview: PeopleOverview;
	onPerson: (key: string) => void;
}) {
	const t = useTranslations("mobile.people.bar");
	const money = useMoneyText();
	const faces = useFaces();
	const { color, radius, size, space } = useTheme();
	const [spots, setSpots] = useState<Record<string, number>>({});
	const [width, setWidth] = useState(0);
	const chart = chartColors(color);
	const byKey = new Map(overview.people.map((p) => [p.person.key, p.person]));
	const segments = overview.segments.filter((s) => byKey.has(s.key));
	if (segments.length === 0) return null;
	const owed = segments.filter((s) => s.direction === "owed");
	const owe = segments.filter((s) => s.direction === "owe");
	const face = size.avatar.sm;
	const label = (s: Segment) => {
		const name = byKey.get(s.key)?.name ?? "";
		return t(s.direction === "owed" ? "owesYou" : "youOwe", {
			name,
			amount: money(s.amount),
		});
	};
	const segment = (s: Segment) => (
		<Pressable
			accessibilityLabel={label(s)}
			accessibilityRole="button"
			hitSlop={{ top: space[4], bottom: space[4] }}
			key={idOf(s)}
			onLayout={(event) => {
				const { x, width: w } = event.nativeEvent.layout;
				setSpots((now) => ({ ...now, [idOf(s)]: x + w / 2 }));
			}}
			onPress={() => onPerson(s.key)}
			style={{
				flex: s.share,
				minWidth: space[1],
				height: THIN.balance,
				borderRadius: radius.chip,
				overflow: "hidden",
				backgroundColor:
					s.direction === "owed"
						? seriesColor(color, avatarSlot(s.key))
						: chart.track,
			}}
		>
			{s.direction === "owe" ? (
				<Svg height="100%" width="100%">
					<Defs>
						<Pattern
							height={HATCH.size}
							id="hatch"
							patternTransform="rotate(45)"
							patternUnits="userSpaceOnUse"
							width={HATCH.size}
						>
							<Rect
								fill={chart.label}
								height={HATCH.size}
								width={HATCH.stripe}
							/>
						</Pattern>
					</Defs>
					<Rect fill="url(#hatch)" height="100%" width="100%" />
				</Svg>
			) : null}
		</Pressable>
	);
	return (
		<View>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{ height: face + space[2] + space[1] }}
			>
				{pinsOf(segments).map((s) => {
					const center = spots[idOf(s)];
					const person = byKey.get(s.key);
					if (center === undefined || !person) return null;
					const left = Math.min(
						Math.max(center, face / 2),
						Math.max(width - face / 2, face / 2),
					);
					const [shown] = faces([person]);
					return (
						<View
							key={`pin-${idOf(s)}`}
							style={{
								position: "absolute",
								bottom: 0,
								left: left - face / 2,
								alignItems: "center",
							}}
						>
							{shown ? <Avatar face={shown} size="sm" /> : null}
							<View
								style={{
									width: 1,
									height: space[1],
									backgroundColor: color.lineStrong,
								}}
							/>
						</View>
					);
				})}
			</View>
			<View
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				style={{ flexDirection: "row", gap: THIN.gap, height: THIN.balance }}
			>
				{owed.map(segment)}
				{owe.length > 0 && owed.length > 0 ? (
					<View style={{ width: space[3] }} />
				) : null}
				{owe.map(segment)}
			</View>
		</View>
	);
}
