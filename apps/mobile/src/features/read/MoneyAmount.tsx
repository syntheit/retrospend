import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { type Money, useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";

type Tone = "default" | "positive" | "muted";

/**
 * An amount as entered with its home value under it (GUIDELINE §7): the
 * original first with its currency code, the home amount second and muted.
 * `home` undefined means the same currency (one line); null means the entry
 * has no rate yet, which reads as words, never as 1 or 0. Right-aligned with
 * tabular figures so a column of them shares one edge.
 */
export function MoneyAmount({
	value,
	home,
	rateType,
	tone = "default",
	sign = "auto",
	strong,
	align = "right",
	size = "body",
}: {
	value: Money;
	home?: Money | null;
	/** Shown after the home amount when it is not the default rate type. */
	rateType?: string;
	tone?: Tone;
	sign?: "auto" | "exceptZero";
	strong?: boolean;
	align?: "left" | "right";
	size?: "body" | "section" | "hero";
}) {
	const t = useTranslations("mobile.money");
	const { color, type } = useTheme();
	const { format, pair } = useFormatMoney();
	const { original, home: homeText } =
		home === undefined
			? { original: format(value, { sign }), home: null }
			: pair(value, home, { sign });
	const textAlign = align;
	const fontSize =
		size === "hero"
			? type.hero.size
			: size === "section"
				? type.section.size
				: type.body.size;
	const tabular = ["tabular-nums" as const];
	return (
		<View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
			<Text
				numberOfLines={1}
				style={{
					color:
						tone === "positive"
							? color.positive
							: tone === "muted"
								? color.fg3
								: color.fg,
					fontSize,
					fontVariant: tabular,
					fontWeight: strong || size === "hero" ? "600" : "500",
					textAlign,
				}}
			>
				{original}
			</Text>
			{home === undefined ? null : (
				<Text
					numberOfLines={1}
					style={{
						color: color.fg2,
						fontSize: type.small.size,
						fontVariant: tabular,
						textAlign,
					}}
				>
					{homeText === null
						? t("noRate")
						: rateType
							? t("homeWithRate", { amount: homeText, rate: rateType })
							: homeText}
				</Text>
			)}
		</View>
	);
}
