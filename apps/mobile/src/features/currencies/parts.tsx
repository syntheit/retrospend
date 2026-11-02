import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { localCurrencyName } from "@/lib/currency-names";
import { useRateFormat } from "@/lib/rateFormat";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { HAIRLINE } from "@/ui/metrics";
import { Text } from "@/ui/Text";
import { type CurrencyRow, type RatePrice, rateTypeKey } from "./source";

/** A rate type's name: Official, Blue, MEP; an unknown one capitalized. */
export function useRateLabel() {
	const t = useTranslations("mobile.currencies.rateTypes");
	return (type: string) => {
		const key = rateTypeKey(type);
		return key ? t(key) : type.charAt(0).toUpperCase() + type.slice(1);
	};
}

/**
 * English names come title-cased ("Brazilian Real"); the app writes them in
 * sentence case ("Brazilian real"): the last word of a name with several
 * goes lower, unless it is an acronym. Other languages' names already are.
 */
export function sentenceCaseName(name: string, locale: string): string {
	if (!locale.toLowerCase().startsWith("en")) return name;
	const at = name.lastIndexOf(" ");
	if (at < 0) return name;
	const last = name.slice(at + 1);
	if (last !== last.toLowerCase() && last === last.toUpperCase()) return name;
	return `${name.slice(0, at + 1)}${last.toLowerCase()}`;
}

export function useCurrencyName() {
	const locale = useLocale();
	return (code: string) =>
		sentenceCaseName(localCurrencyName(code, locale), locale);
}

/**
 * A price through the shared rate formatter (R8): "1 USD = 1,545.20 ARS" or,
 * where the screen already names the one unit, "1,545.20 ARS".
 */
export function usePriceText() {
	const fmt = useRateFormat();
	return (price: RatePrice, showBase: boolean) => {
		// The price counts `minor` x 10^-places of its currency per 1 base.
		const perBase = price.minor / 10 ** price.places;
		return (
			(showBase
				? fmt.rate(price.base, price.currency, perBase)
				: fmt.inUnit(price.base, price.base, price.currency, perBase)) ?? ""
		);
	};
}

/** A rate day ("Oct 21"), in the app language. */
export function useDayText() {
	const format = useFormatter();
	return (day: string) =>
		format.dateTime(new Date(`${day}T12:00:00Z`), {
			month: "short",
			day: "numeric",
			timeZone: "UTC",
		});
}

/**
 * A price, right-aligned with tabular figures. `showBase` words the whole
 * rate ("1 USD = 1,545.20 ARS") where the screen does not already name one
 * unit for every price.
 */
export function PriceText({
	price,
	showBase,
	strong,
}: {
	price: RatePrice;
	showBase: boolean;
	strong?: boolean;
}) {
	const text = usePriceText();
	return (
		<Text
			numberOfLines={1}
			style={{ textAlign: "right" }}
			tabular
			weight={strong ? "semibold" : "medium"}
		>
			{text(price, showBase)}
		</Text>
	);
}

/**
 * The favorite star (the one star the guideline allows: it has a job). A
 * currency with no rate row of its own (USD is the table's base) cannot be
 * starred yet, and says so.
 */
export function StarButton({
	row,
	busy,
	onToggle,
}: {
	row: CurrencyRow;
	busy: boolean;
	onToggle: (on: boolean) => void;
}) {
	const t = useTranslations("mobile.currencies.star");
	const { color, size } = useTheme();
	const blocked = !row.favorite && !row.rateId;
	const label = blocked
		? t("unavailable", { code: row.code })
		: row.favorite
			? t("remove", { code: row.code })
			: t("add", { code: row.code });
	const slop = (size.touchMin.phone - size.icon.phone) / 2;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			accessibilityState={{
				selected: row.favorite,
				disabled: busy || blocked,
			}}
			disabled={busy}
			hitSlop={slop}
			onPress={() => {
				if (!blocked) onToggle(!row.favorite);
			}}
			style={{
				width: size.icon.phone,
				height: size.icon.phone,
				alignItems: "center",
				justifyContent: "center",
				opacity: blocked ? 0.5 : 1,
			}}
		>
			<Glyph
				color={row.favorite ? color.fg : color.fg3}
				filled={row.favorite}
				name="Star"
				size={size.icon.phone}
			/>
		</Pressable>
	);
}

/** One line of a rate list: the type (with its notes) and a figure at the end. */
export function TypeLine({
	label,
	note,
	derived,
	children,
}: {
	label: string;
	note?: string;
	derived?: string;
	children: ReactNode;
}) {
	const { color, size, space } = useTheme();
	return (
		<View
			style={{
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[3],
				paddingVertical: space[2],
				borderBottomWidth: HAIRLINE,
				borderBottomColor: color.line,
			}}
		>
			<View style={{ flex: 1, gap: space[1] }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "baseline",
						gap: space[2],
					}}
				>
					<Text>{label}</Text>
					{note ? (
						<Text tone="fg3" variant="meta">
							{note}
						</Text>
					) : null}
				</View>
				{derived ? (
					<Text tone="fg3" variant="meta">
						{derived}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}
