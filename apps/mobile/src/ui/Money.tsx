import { getDecimalDigits } from "@retrospend/domain/currency-format";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { type Money, useFormatMoney } from "@/lib/money";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { fitMoney } from "./fitMoney";
import { Text } from "./Text";

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
	weight: weightName = "medium",
	align = "right",
	size = "body",
	approx,
	code,
	cents: centsProp,
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
	/**
	 * Precision for a list of figures that must read alike (every minor digit,
	 * or whole units); default is the formatter's own, the hero's for a hero.
	 */
	cents?: boolean;
}) {
	const t = useTranslations("mobile.money");
	const rateName = useRateTypeLabel();
	const { size: sizes, type } = useTheme();
	const { format, pair } = useFormatMoney();
	const hero = size === "hero";
	const cents = centsProp ?? (hero ? heroCents(value.currency) : undefined);
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
	const heroSize = sizes.hero.phone;
	const weight =
		strong || hero ? "semibold" : weightName === "normal" ? "normal" : "medium";
	const rate = rateType ? rateName(rateType) : "";
	return (
		<View
			style={{
				// Shrinks with its row, so the figure fits instead of overflowing.
				flexShrink: 1,
				alignItems: align === "right" ? "flex-end" : "flex-start",
			}}
		>
			<Text
				{...fitMoney}
				style={[
					{ textAlign: align },
					hero
						? {
								fontSize: heroSize,
								lineHeight: heroSize * type.hero.lineHeight,
								letterSpacing: heroSize * type.hero.tracking,
							}
						: null,
				]}
				tabular
				tone={
					tone === "positive" ? "positive" : tone === "muted" ? "fg3" : "fg"
				}
				variant={hero ? "hero" : size === "section" ? "section" : "body"}
				weight={weight}
			>
				{shown}
			</Text>
			{showHome ? (
				<Text
					{...fitMoney}
					style={{ textAlign: align }}
					tabular
					tone="fg3"
					variant="meta"
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
