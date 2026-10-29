import { getDecimalDigits } from "@retrospend/domain/currency-format";
import { Text, type TextStyle, View } from "react-native";
import { useTranslations } from "use-intl";
import { type Money, useFormatMoney } from "@/lib/money";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";

/** A weight token (400, 500, 600) as the style value React Native takes. */
const weightStyle = (value: number) => String(value) as TextStyle["fontWeight"];

type Tone = "default" | "positive" | "muted";

/**
 * The hero's precision, as the web's `heroCents()`: whole units for a
 * currency the formatter shows without cents (ARS, CLP...), else the
 * formatter's default. The formatter rounds; the screen never does.
 */
export function heroCents(currency: string): false | "auto" {
	return getDecimalDigits(currency) === 0 ? false : "auto";
}

/**
 * A rate type's name for a money line ("at Blue"), ported from the web's
 * `rateTypeLabel`: known types from the catalog, a new one as its key with
 * a capital first, never a raw key.
 */
export const useRateTypeLabel = useRateTypeName;

/**
 * An amount as entered with its home value under it (GUIDELINE §7): the
 * original first with its currency code, the home amount second, 12 and
 * fg-3. `home` undefined means the same currency (one line); null means the
 * entry has no rate yet, which reads as words, never as 1 or 0. Right-aligned
 * with tabular figures so a column of them shares one edge.
 *
 * Sizes: `body` for rows (500, or 400 with `weight="normal"`), `section` for
 * a total, `hero` for the one hero number (28 on phones, 600, the hero cents
 * rule). `strong` (600) is for a net balance that leads its row.
 */
export function MoneyAmount({
	value,
	home,
	rateType,
	tone = "default",
	sign = "auto",
	strong,
	weight = "medium",
	align = "right",
	size = "body",
	approx,
	code,
}: {
	value: Money;
	home?: Money | null;
	/** Shown after the home amount when it is not the default rate type. */
	rateType?: string;
	tone?: Tone;
	sign?: "auto" | "exceptZero";
	strong?: boolean;
	/** A row amount's weight: 500, or 400 for a quiet column. */
	weight?: "normal" | "medium";
	align?: "left" | "right";
	size?: "body" | "section" | "hero";
	/** The amount is a total converted at reference rates, so it reads "≈". */
	approx?: boolean;
	/** Shows the currency code, not the home symbol (a rate, not a home amount). */
	code?: boolean;
}) {
	const t = useTranslations("mobile.money");
	const rateName = useRateTypeLabel();
	const { color, font, size: sizes, type } = useTheme();
	const { format, pair } = useFormatMoney();
	const hero = size === "hero";
	const cents = hero ? heroCents(value.currency) : undefined;
	const options = {
		sign,
		...(cents === undefined ? {} : { cents }),
	};
	const { original, home: homeText } =
		home === undefined
			? {
					original: format(value, {
						...options,
						...(code ? { display: "code" } : {}),
					}),
					home: null,
				}
			: pair(value, home, options);
	const shown = approx ? t("approx", { amount: original ?? "" }) : original;
	// A home value in the entry's own currency adds nothing: one line.
	const showHome =
		home !== undefined && !(home && home.currency === value.currency);
	const textAlign = align;
	const fontSize = hero
		? sizes.hero.phone
		: size === "section"
			? type.section.size
			: type.body.size;
	const fontWeight = weightStyle(
		strong || hero
			? font.weight.semibold
			: weight === "normal"
				? font.weight.normal
				: font.weight.medium,
	);
	const tabular = ["tabular-nums" as const];
	const rate = rateType ? rateName(rateType) : "";
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
					fontWeight,
					...(hero ? { letterSpacing: type.hero.tracking * fontSize } : {}),
					textAlign,
				}}
			>
				{shown}
			</Text>
			{showHome ? (
				<Text
					numberOfLines={1}
					style={{
						color: color.fg3,
						fontSize: type.meta.size,
						fontVariant: tabular,
						textAlign,
					}}
				>
					{home === null || homeText === null
						? t("noRate")
						: rate
							? t("homeWithRate", { amount: homeText, rate })
							: homeText}
				</Text>
			) : null}
		</View>
	);
}
