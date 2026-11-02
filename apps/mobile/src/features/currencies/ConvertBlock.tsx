import { parseMoneyInput } from "@retrospend/domain/parse";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { MoneyCell } from "./MoneyCell";
import { TypeLine, useRateLabel } from "./parts";
import {
	type Conversion,
	type ConvertDirection,
	type CurrencyRow,
	defaultPrice,
} from "./source";
import { useConvert } from "./useCurrencies";

/** A result per rate type, as the server converted it. */
export function ConversionLines({
	result,
	home,
}: {
	result: Conversion | null;
	home: string;
}) {
	const t = useTranslations("mobile.currencies");
	const label = useRateLabel();
	const { format } = useFormatMoney();
	return (
		<View accessibilityLiveRegion="polite">
			{(result?.results ?? []).map((r) => (
				<TypeLine
					derived={r.derived ? t("derived", { home }) : undefined}
					key={r.type}
					label={label(r.type)}
				>
					<Text
						numberOfLines={1}
						style={{ textAlign: "right" }}
						tabular
						weight="semibold"
					>
						{format(r.value) ?? ""}
					</Text>
				</TypeLine>
			))}
		</View>
	);
}

/**
 * Convert: one amount of the stronger currency of the pair into the weaker
 * (Swap turns it around), and a result per rate type. The amount is read
 * with the shared parser here and converted on the server.
 */
export function ConvertBlock({
	row,
	home,
}: {
	row: CurrencyRow;
	home: string;
}) {
	const t = useTranslations("mobile.currencies.convert");
	const locale = useMoneyLocale();
	const { space } = useTheme();
	const [direction, setDirection] = useState<ConvertDirection>(
		// The stronger currency is the one unit: from home when home is the base.
		defaultPrice(row)?.base === home ? "fromHome" : "toHome",
	);
	const [text, setText] = useState("100");
	const from = direction === "toHome" ? row.code : home;
	const to = direction === "toHome" ? home : row.code;
	const parsed = parseMoneyInput(text, locale, from);
	const { result, failed } = useConvert(
		row.code,
		parsed.ok ? parsed.minor : null,
		direction,
	);
	return (
		<View style={{ gap: space[2] }}>
			<Text accessibilityRole="header" variant="section">
				{t("title")}
			</Text>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<Text>{t("amount")}</Text>
				<MoneyCell
					currency={from}
					invalid={text.trim() !== "" && !parsed.ok}
					label={t("amount")}
					onChange={setText}
					showCurrency
					value={text}
				/>
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<Text tone="fg2">{t("into", { code: to })}</Text>
				<Button
					label={t("swap")}
					onPress={() =>
						setDirection((d) => (d === "toHome" ? "fromHome" : "toHome"))
					}
					variant="text"
				/>
			</View>
			{failed ? (
				<Text tone="danger" variant="small">
					{t("failed")}
				</Text>
			) : (
				<ConversionLines home={home} result={result} />
			)}
		</View>
	);
}
