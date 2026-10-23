"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useThemeContext } from "~/components/theme-provider";
import { Segmented } from "~/components/ui/segmented";
import { Switch } from "~/components/ui/switch";
import { setLocaleCookie } from "~/i18n/actions";
import { type AppLocale, LOCALE_OPTIONS } from "~/i18n/locales";
import { api } from "~/trpc/react";
import { useAutosave, useSaveGuard } from "../autosave";
import { SelectField } from "../select-field";
import { SettingRow, SettingRows } from "../setting-row";
import { TimeZoneRow } from "./time-zone-row";
import {
	type GeneralSettings,
	type GeneralSettingsApi,
	useSaveSetting,
} from "./use-general-settings";

type Theme = "light" | "dark" | "auto";

/** Display: theme, language (no reload), hidden Wealth balances, chart taps. */
export function DisplayRows({
	settings,
	writer,
}: {
	settings: GeneralSettings;
	writer: GeneralSettingsApi;
}) {
	const t = useTranslations("settingsV2.preferences");
	const autosave = useAutosave();
	const guard = useSaveGuard();
	const save = useSaveSetting(writer);
	const router = useRouter();
	const { preference, setTheme } = useThemeContext();
	const language = (settings.language ?? "en") as AppLocale;
	const click = settings.categoryClickBehavior ?? "toggle";

	// The cookie picks the locale next-intl renders; a refresh re-renders the
	// server parts in it without reloading the page.
	const setLanguage = async (value: AppLocale) => {
		await writer.update({ language: value });
		await setLocaleCookie(value);
		router.refresh();
	};

	return (
		<SettingRows>
			<SettingRow label={t("theme")}>
				<Segmented<Theme>
					label={t("theme")}
					onChange={(v) =>
						void guard("theme", () =>
							autosave({
								apply: async (theme: Theme) => setTheme(theme),
								next: v,
								prev: preference as Theme,
							}),
						)
					}
					options={[
						{ value: "light", label: t("themeLight") },
						{ value: "dark", label: t("themeDark") },
						{ value: "auto", label: t("themeSystem") },
					]}
					value={preference as Theme}
				/>
			</SettingRow>
			<SettingRow label={t("language")} labelFor="pf-lang">
				<SelectField
					id="pf-lang"
					onChange={(v) =>
						void guard("language", () =>
							autosave({
								apply: setLanguage,
								next: v,
								prev: (writer.current("language") ?? "en") as AppLocale,
							}),
						)
					}
					options={LOCALE_OPTIONS.map((o) => ({
						value: o.value,
						label: o.label,
					}))}
					value={language}
				/>
			</SettingRow>
			<TimeZoneRow timeZone={settings.timeZone} writer={writer} />
			<SettingRow
				label={t("hideBalances")}
				labelFor="pf-privacy"
				meta={t("hideBalancesMeta")}
			>
				<Switch
					checked={settings.defaultPrivacyMode ?? false}
					id="pf-privacy"
					onCheckedChange={(on) =>
						void save("defaultPrivacyMode", on, { fallback: false })
					}
				/>
			</SettingRow>
			<SettingRow label={t("chartTap")} labelFor="pf-click">
				<SelectField
					id="pf-click"
					onChange={(v) =>
						void save("categoryClickBehavior", v, { fallback: "toggle" })
					}
					options={[
						{ value: "navigate", label: t("chartTapOpen") },
						{ value: "toggle", label: t("chartTapHide") },
					]}
					value={click}
				/>
			</SettingRow>
		</SettingRows>
	);
}

/** Defaults: the date a new expense starts on, and who reads statements. */
export function DefaultRows({
	settings,
	writer,
}: {
	settings: GeneralSettings;
	writer: GeneralSettingsApi;
}) {
	const t = useTranslations("settingsV2.preferences");
	const save = useSaveSetting(writer);
	const utils = api.useUtils();
	const { data: ai } = api.settings.getAiStatus.useQuery();
	const date = settings.defaultExpenseDateBehavior ?? "TODAY";
	const mode = settings.aiMode ?? "LOCAL";
	const setMode = async (aiMode: "LOCAL" | "EXTERNAL") => {
		await save("aiMode", aiMode, { fallback: "LOCAL" });
		await utils.settings.getAiStatus.invalidate();
	};
	const meta =
		mode === "EXTERNAL" && ai?.quotaRemaining != null
			? t("importExternalLeft", { count: ai.quotaRemaining })
			: ai && !ai.externalAvailable && ai.externalDeniedReason
				? ai.externalDeniedReason
				: t("importMeta");

	return (
		<SettingRows>
			<SettingRow label={t("expenseDate")}>
				<Segmented
					label={t("expenseDate")}
					onChange={(v) =>
						void save("defaultExpenseDateBehavior", v, { fallback: "TODAY" })
					}
					options={[
						{ value: "TODAY", label: t("expenseDateToday") },
						{ value: "LAST_USED", label: t("expenseDateLast") },
					]}
					value={date}
				/>
			</SettingRow>
			<SettingRow label={t("import")} meta={meta}>
				<Segmented
					label={t("import")}
					onChange={(v) => void setMode(v)}
					options={[
						{ value: "LOCAL", label: t("importLocal") },
						{
							value: "EXTERNAL",
							label: t("importExternal"),
							disabled: mode !== "EXTERNAL" && !ai?.externalAvailable,
						},
					]}
					value={mode}
				/>
			</SettingRow>
		</SettingRows>
	);
}
