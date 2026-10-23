"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { SelectField } from "../select-field";
import { SettingRow } from "../setting-row";
import {
	type GeneralSettingsApi,
	useSaveSetting,
} from "./use-general-settings";

/** The browser's zone list, plus the stored zone when the browser spells it differently. */
function zoneOptions(current: string) {
	const zones = Intl.supportedValuesOf("timeZone");
	const all = zones.includes(current) ? zones : [current, ...zones];
	return all.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

/**
 * Time zone: the zone the server reads days in when a request carries none
 * (the API, reminders). Set from the browser on the first visit, so it is
 * empty only until then.
 */
export function TimeZoneRow({
	timeZone,
	writer,
}: {
	timeZone: string | null;
	writer: GeneralSettingsApi;
}) {
	const t = useTranslations("settingsV2.preferences");
	const save = useSaveSetting(writer);
	const value = timeZone ?? "";
	const options = useMemo(() => zoneOptions(value), [value]);
	if (!timeZone) return null;
	return (
		<SettingRow label={t("timeZone")} labelFor="pf-tz" meta={t("timeZoneMeta")}>
			<SelectField
				id="pf-tz"
				onChange={(v) => void save("timeZone", v)}
				options={options}
				value={timeZone}
			/>
		</SettingRow>
	);
}
