import { router } from "expo-router";
import { useTranslations } from "use-intl";
import {
	type LanguagePref,
	setLanguagePref,
	useLanguagePref,
} from "@/lib/language-pref";
import { APP_LOCALES, LANGUAGE_NAMES } from "@/lib/locales";
import { ListGroup, ListRow } from "@/ui/List";
import { WheelField } from "@/ui/Picker";
import { NumbersGroup } from "./NumbersSection";
import {
	Block,
	CurrencyRow,
	GroupNote,
	PageState,
	PickerRow,
	SettingsPage,
} from "./parts";
import { MONTH_START_DAYS } from "./source";
import { useSaveSettings } from "./useSaveSettings";
import { useFiatCurrencies, useGeneralSettings } from "./useSettings";

/**
 * Preferences: how money reads and what new expenses start with (home
 * currency, default currency, month start, number format, Currencies) and
 * how the app looks on this phone (language). Every change saves at once,
 * from the server's answer.
 */
export function PreferencesSection() {
	const t = useTranslations("mobile.settings");
	const general = useGeneralSettings();
	const currencies = useFiatCurrencies();
	const language = useLanguagePref();
	const save = useSaveSettings(general.reload);
	const settings = general.state.status === "ready" ? general.state.data : null;
	if (!settings) {
		return (
			<PageState
				failed={general.state.status === "error"}
				onRetry={() => void general.reload()}
			/>
		);
	}

	const languageOptions = [
		{ value: "device" as const, label: t("language.device") },
		...APP_LOCALES.map((value) => ({
			value,
			label: LANGUAGE_NAMES[value],
		})),
	];

	const known =
		currencies.state.status === "ready" ? currencies.state.data.items : [];
	const yours = [settings.homeCurrency, settings.defaultCurrency].filter(
		(code): code is string => Boolean(code),
	);
	// A currency the list does not carry is still the current one.
	const codes = [...new Set([...known.map((c) => c.code), ...yours])];

	return (
		<SettingsPage>
			<Block title={t("money.title")}>
				<ListGroup form>
					<CurrencyRow
						currencies={codes}
						label={t("money.home")}
						onChange={(homeCurrency) => save({ homeCurrency })}
						value={settings.homeCurrency}
						yours={yours}
					/>
					<CurrencyRow
						currencies={codes}
						label={t("money.default")}
						onChange={(defaultCurrency) => save({ defaultCurrency })}
						value={settings.defaultCurrency}
						yours={yours}
					/>
					<WheelField
						label={t("money.monthStart")}
						onChange={(day) => save({ fiscalMonthStartDay: Number(day) })}
						options={MONTH_START_DAYS.map((d) => ({
							value: String(d),
							label: String(d),
						}))}
						value={String(settings.fiscalMonthStartDay)}
					/>
					<ListRow
						chevron
						onPress={() => router.push("/settings/currencies")}
						title={t("rates.currencies")}
					/>
				</ListGroup>
				<GroupNote>{t("money.footer")}</GroupNote>
			</Block>
			<Block title={t("numbers.title")}>
				<NumbersGroup onSaved={general.reload} settings={settings} />
			</Block>
			<Block title={t("display")}>
				<ListGroup form>
					<PickerRow<LanguagePref>
						label={t("language.label")}
						onChange={setLanguagePref}
						options={languageOptions}
						value={language}
					/>
				</ListGroup>
				<GroupNote>{t("device.footer")}</GroupNote>
			</Block>
		</SettingsPage>
	);
}
