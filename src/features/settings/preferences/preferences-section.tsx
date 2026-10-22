"use client";

import { useTranslations } from "next-intl";
import { SettingGroup } from "../setting-row";
import {
	SectionShell,
	SectionUnavailable,
	SkeletonRowsFor,
} from "../section-shell";
import { DefaultRows, DisplayRows } from "./display-rows";
import { MoneyRows } from "./money-rows";
import { useGeneralSettings } from "./use-general-settings";

/** Preferences: Money, Display and Defaults, each row saving on change. */
export function PreferencesSection() {
	const t = useTranslations("settingsV2");
	const { settings, isError, refetch, update } = useGeneralSettings();
	return (
		<SectionShell id="preferences" title={t("sections.preferences")}>
			{settings ? (
				<>
					<SettingGroup first title={t("preferences.money")}>
						<MoneyRows settings={settings} update={update} />
					</SettingGroup>
					<SettingGroup title={t("preferences.display")}>
						<DisplayRows settings={settings} update={update} />
					</SettingGroup>
					<SettingGroup title={t("preferences.defaults")}>
						<DefaultRows settings={settings} update={update} />
					</SettingGroup>
				</>
			) : isError ? (
				<SectionUnavailable onRetry={() => void refetch()} />
			) : (
				<SkeletonRowsFor count={6} />
			)}
		</SectionShell>
	);
}
