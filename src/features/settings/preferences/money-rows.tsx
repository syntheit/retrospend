"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Segmented } from "~/components/ui/segmented";
import { Switch } from "~/components/ui/switch";
import { useAutosave } from "../autosave";
import { SelectField } from "../select-field";
import { SettingRow, SettingRows } from "../setting-row";
import { CurrencyField } from "./currency-field";
import { monthSpan } from "./month-span";
import type { GeneralPatch, GeneralSettings } from "./use-general-settings";

const DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));

/**
 * Money: home currency, the default for new expenses, symbol style, smart
 * formatting and the day the month starts. Monthly income is gone (money in
 * is recorded as income now, IMPLEMENTATION §1.1). The default rate type
 * arrives with M2 (docs/ui/GAPS.md).
 */
export function MoneyRows({
	settings,
	update,
}: {
	settings: GeneralSettings;
	update: (patch: GeneralPatch) => Promise<void>;
}) {
	const t = useTranslations("settingsV2.preferences");
	const save = useAutosave();
	const dates = useDateFormat();
	const startDay = settings.fiscalMonthStartDay ?? 1;
	const span = monthSpan(new Date(), startDay);
	const symbol = settings.currencySymbolStyle ?? "standard";
	const defaultCurrency = settings.defaultCurrency ?? settings.homeCurrency;

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
						void save({
							apply: (homeCurrency) => update({ homeCurrency }),
							next: code,
							prev: settings.homeCurrency,
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
						void save({
							apply: (v) => update({ defaultCurrency: v }),
							next: code,
							prev: defaultCurrency,
							message: t("defaultCurrencySaved", { code }),
						})
					}
					value={defaultCurrency}
				/>
			</SettingRow>
			<SettingRow label={t("symbol")} meta={t("symbolMeta")}>
				<Segmented
					label={t("symbol")}
					onChange={(v) =>
						void save({
							apply: (currencySymbolStyle) => update({ currencySymbolStyle }),
							next: v,
							prev: symbol,
						})
					}
					options={[
						{ value: "standard", label: t("symbolStandard") },
						{ value: "native", label: t("symbolNative") },
					]}
					value={symbol}
				/>
			</SettingRow>
			<SettingRow label={t("smart")} labelFor="pf-smart" meta={t("smartMeta")}>
				<Switch
					checked={settings.smartCurrencyFormatting ?? true}
					id="pf-smart"
					onCheckedChange={(on) =>
						void save({
							apply: (smartCurrencyFormatting) =>
								update({ smartCurrencyFormatting }),
							next: on,
							prev: !on,
						})
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
						void save({
							apply: (day) => update({ fiscalMonthStartDay: Number(day) }),
							next: v,
							prev: String(startDay),
						})
					}
					options={DAYS.map((d) => ({ value: d, label: d }))}
					value={String(startDay)}
				/>
			</SettingRow>
		</SettingRows>
	);
}
