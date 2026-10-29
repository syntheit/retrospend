import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { localCurrencyName } from "@/lib/currency-names";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { Text } from "@/ui/Text";
import {
	type CurrencyRow,
	priceCents,
	type RatePrice,
	rateTypeKey,
} from "./source";

/** A rate type's name: Official, Blue, MEP; an unknown one capitalized. */
export function useRateLabel() {
	const t = useTranslations("mobile.currencies.rateTypes");
	return (type: string) => {
		const key = rateTypeKey(type);
		return key ? t(key) : type.charAt(0).toUpperCase() + type.slice(1);
	};
}

export function useCurrencyName() {
	const locale = useLocale();
	return (code: string) => localCurrencyName(code, locale);
}

/** A price as the server sent it, through the one formatter, with its places. */
export function usePriceText() {
	const { format } = useFormatMoney();
	return (price: RatePrice) =>
		format(price, { places: price.places, cents: priceCents(price) }) ?? "";
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
 * A price, right-aligned with tabular figures. `showBase` adds the single
 * unit it is for ("1 USD =") in muted text, where the screen does not
 * already name one unit for every price.
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
	const t = useTranslations("mobile.currencies");
	const text = usePriceText();
	const { space } = useTheme();
	return (
		<View
			style={{ flexDirection: "row", alignItems: "baseline", gap: space[1] }}
		>
			{showBase ? (
				<Text tone="fg3" variant="meta">
					{t("base", { code: price.base })}
				</Text>
			) : null}
			<Text
				numberOfLines={1}
				style={{ textAlign: "right" }}
				tabular
				weight={strong ? "semibold" : "medium"}
			>
				{text(price)}
			</Text>
		</View>
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
				borderBottomWidth: 1,
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
