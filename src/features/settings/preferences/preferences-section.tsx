"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
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
	const { settings, isError, refetch, update, current } = useGeneralSettings();
	const writer = useMemo(() => ({ update, current }), [update, current]);
	return (
		<SectionShell id="preferences" title={t("sections.preferences")}>
			{settings ? (
				<>
					<SettingGroup first title={t("preferences.money")}>
						<MoneyRows settings={settings} writer={writer} />
					</SettingGroup>
					<SettingGroup title={t("preferences.display")}>
						<DisplayRows settings={settings} writer={writer} />
					</SettingGroup>
					<SettingGroup title={t("preferences.defaults")}>
						<DefaultRows settings={settings} writer={writer} />
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
