import { parseMoneyInput } from "@retrospend/domain/parse";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
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
	const { color, type } = useTheme();
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
						style={{
							color: color.fg,
							fontSize: type.body.size,
							fontVariant: ["tabular-nums"],
							fontWeight: "600",
							textAlign: "right",
						}}
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
	const { color, space, type } = useTheme();
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
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{t("title")}
			</Text>
			<TextField
				invalid={text.trim() !== "" && !parsed.ok}
				keyboardType="decimal-pad"
				label={t("amount")}
				onChangeText={setText}
				prefix={from}
				value={text}
			/>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("into", { code: to })}
				</Text>
				<Button
					label={t("swap")}
					onPress={() =>
						setDirection((d) => (d === "toHome" ? "fromHome" : "toHome"))
					}
					variant="text"
				/>
			</View>
			{failed ? (
				<Text style={{ color: color.danger, fontSize: type.small.size }}>
					{t("failed")}
				</Text>
			) : (
				<ConversionLines home={home} result={result} />
			)}
		</View>
	);
}
