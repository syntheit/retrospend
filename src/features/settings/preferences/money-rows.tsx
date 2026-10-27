"use client";

import {
	type NumberFormatOption,
	numberFormatExamples,
} from "@retrospend/domain/format";
import { useLocale, useTranslations } from "next-intl";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Segmented } from "~/components/ui/segmented";
import { Switch } from "~/components/ui/switch";
import { SelectField } from "../select-field";
import { SettingRow, SettingRows } from "../setting-row";
import { CurrencyField } from "./currency-field";
import { monthSpan } from "./month-span";
import {
	type GeneralSettings,
	type GeneralSettingsApi,
	useSaveSetting,
} from "./use-general-settings";

const DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));

/**
 * Money: home currency, the default for new expenses, symbol style, number
 * format, smart formatting and the day the month starts. Monthly income is gone (money in
 * is recorded as income now, IMPLEMENTATION §1.1). The default rate type
 * arrives with M2 (docs/ui/GAPS.md).
 */
export function MoneyRows({
	settings,
	writer,
}: {
	settings: GeneralSettings;
	writer: GeneralSettingsApi;
}) {
	const t = useTranslations("settingsV2.preferences");
	const save = useSaveSetting(writer);
	const dates = useDateFormat();
	const language = useLocale();
	const startDay = settings.fiscalMonthStartDay ?? 1;
	const span = monthSpan(new Date(), startDay);
	const symbol = settings.currencySymbolStyle ?? "standard";
	const defaultCurrency = settings.defaultCurrency ?? settings.homeCurrency;
	// Each option reads as the user's own amount, in the language's pattern.
	const examples = numberFormatExamples(settings.homeCurrency, language);
	const formatOptions: { value: NumberFormatOption; label: string }[] = [
		{ value: "follow", label: t("numberFollow", { example: examples.follow }) },
		{ value: "comma_dot", label: examples.comma_dot },
		{ value: "dot_comma", label: examples.dot_comma },
		{ value: "space_comma", label: examples.space_comma },
	];

	return (
		<SettingRows>
			<SettingRow
				label={t("homeCurrency")}
				labelFor="pf-home"
				meta={t("homeCurrencyMeta")}
			>
				<CurrencyField
					id="pf-home"
					label={t("homeCurrency")}
					onChange={(code) =>
						void save("homeCurrency", code, {
							message: t("homeCurrencySaved", { code }),
						})
					}
					value={settings.homeCurrency}
				/>
			</SettingRow>
			<SettingRow label={t("defaultCurrency")} labelFor="pf-default">
				<CurrencyField
					id="pf-default"
					label={t("defaultCurrency")}
					onChange={(code) =>
						void save("defaultCurrency", code, {
							message: t("defaultCurrencySaved", { code }),
							fallback: settings.homeCurrency,
						})
					}
					value={defaultCurrency}
				/>
			</SettingRow>
			<SettingRow label={t("symbol")} meta={t("symbolMeta")}>
				<Segmented
					label={t("symbol")}
					onChange={(v) =>
						void save("currencySymbolStyle", v, { fallback: "standard" })
					}
					options={[
						{ value: "standard", label: t("symbolStandard") },
						{ value: "native", label: t("symbolNative") },
					]}
					value={symbol}
				/>
			</SettingRow>
			<SettingRow
				label={t("numberFormat")}
				labelFor="pf-number-format"
				meta={t("numberFormatMeta")}
			>
				<SelectField
					id="pf-number-format"
					onChange={(v) =>
						void save("numberFormat", v === "follow" ? null : v, {
							fallback: null,
						})
					}
					options={formatOptions}
					value={settings.numberFormat ?? "follow"}
				/>
			</SettingRow>
			<SettingRow label={t("smart")} labelFor="pf-smart" meta={t("smartMeta")}>
				<Switch
					checked={settings.smartCurrencyFormatting ?? true}
					id="pf-smart"
					onCheckedChange={(on) =>
						void save("smartCurrencyFormatting", on, { fallback: true })
					}
				/>
			</SettingRow>
			<SettingRow
				label={t("monthStart")}
				labelFor="pf-start"
				meta={t("monthStartMeta", {
					start: dates.label.short(span.start),
					end: dates.label.short(span.end),
				})}
			>
				<SelectField
					id="pf-start"
					onChange={(v) =>
						void save("fiscalMonthStartDay", Number(v), { fallback: 1 })
					}
					options={DAYS.map((d) => ({ value: d, label: d }))}
					value={String(startDay)}
				/>
			</SettingRow>
		</SettingRows>
	);
}
