import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { HAIRLINE } from "@/ui/metrics";
import { Skeleton } from "@/ui/Skeleton";

/** One placeholder card on the surface, as Home's cards stand. */
function Card({ second }: { second?: boolean }) {
	const { color, radius, space } = useTheme();
	return (
		<View
			style={{
				flex: 1,
				minWidth: 0,
				padding: space[4],
				gap: space[3],
				backgroundColor: color.surface,
				borderWidth: HAIRLINE,
				borderColor: color.line,
				borderRadius: radius.panel,
			}}
		>
			<Skeleton shape="line" width="40%" />
			<Skeleton shape="money" />
			{second ? <Skeleton shape="line" width="70%" /> : null}
		</View>
	);
}

/**
 * Home while it loads: the lead card and the 2x2 of tiles, in the shape of
 * what arrives, so nothing jumps when the data does.
 */
export function HomeSkeleton() {
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	return (
		<View
			accessibilityLabel={tc("loading")}
			accessibilityRole="progressbar"
			accessibilityState={{ busy: true }}
			accessible
			style={{ paddingHorizontal: space[4], gap: space[3] }}
		>
			<Card second />
			{[0, 1].map((row) => (
				<View key={row} style={{ flexDirection: "row", gap: space[3] }}>
					<Card />
					<Card />
				</View>
			))}
		</View>
	);
}
