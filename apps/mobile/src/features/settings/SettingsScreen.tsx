import { INBOX_NOTIFICATION_TYPES } from "@retrospend/api-contract";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useSignOut } from "@/features/account/useSignOut";
import {
	type LanguagePref,
	setLanguagePref,
	useLanguagePref,
} from "@/lib/language-pref";
import { APP_LOCALES, LANGUAGE_NAMES } from "@/lib/locales";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import {
	Form,
	FormActionRow,
	FormPickerRow,
	FormSection,
	FormSwitchRow,
	FormValueRow,
} from "@/ui/Form";
import { useToast } from "@/ui/Toast";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { ProfileSheet } from "./ProfileSheet";
import { RatesSheet } from "./RatesSheet";
import {
	hostOf,
	MONTH_START_DAYS,
	type NotificationPreference,
	type NotificationType,
	preferenceOf,
	withChannel,
} from "./source";
import {
	useFavoriteRates,
	useFiatCurrencies,
	useGeneralSettings,
	useNotificationPreferences,
	useProfile,
} from "./useSettings";

/**
 * Settings as a native form: the SwiftUI Form on iOS and the M3 grouped
 * list on Android (Expo UI). Profile, money (home currency, default
 * currency, month start), rates, notifications, the connected server and
 * Sign out. Every change saves at once, from the server's answer. Deleting
 * the account is not in API v1 yet, so it has no row here.
 */
export function SettingsScreen() {
	const t = useTranslations("mobile.settings");
	const tn = useTranslations("mobile.settings.notify");
	const { api, local, refreshMe } = useSession();
	const { connection, disconnect } = useServerConnection();
	const toast = useToast();
	const confirmSignOut = useSignOut();
	// Settings is only open while signed in, so the server changes after the
	// session ends; the sign-in screen has the same action for the signed-out case.
	const confirmChangeServer = useSignOut(disconnect);
	const { color } = useTheme();
	const profile = useProfile();
	const general = useGeneralSettings();
	const prefsRead = useNotificationPreferences();
	const rates = useFavoriteRates();
	const currencies = useFiatCurrencies();
	const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
	const [editing, setEditing] = useState(false);
	const [showRates, setShowRates] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const language = useLanguagePref();

	// The switches follow the server's answer, and change at once when tapped.
	useEffect(() => {
		if (prefsRead.state.status === "ready") {
			setPrefs(prefsRead.state.data.preferences);
		}
	}, [prefsRead.state]);

	const settings = general.state.status === "ready" ? general.state.data : null;
	const me = profile.state.status === "ready" ? profile.state.data : null;
	const pinned = rates.state.status === "ready" ? rates.state.data.items : [];
	const server =
		connection.status === "connected" ? hostOf(connection.baseUrl) : "";

	if (
		general.state.status === "loading" &&
		profile.state.status === "loading"
	) {
		return <EmptyState title="" />;
	}
	if (!settings && !me) {
		return <EmptyState detail={t("errorDetail")} title={t("error")} />;
	}

	const languageOptions = [
		{ value: "device" as const, label: t("language.device") },
		...APP_LOCALES.map((value) => ({
			value,
			label: LANGUAGE_NAMES[value],
		})),
	];

	const currencyOptions = (() => {
		const known =
			currencies.state.status === "ready" ? currencies.state.data.items : [];
		const list = known.map((c) => ({
			value: c.code,
			label: `${c.code} · ${c.name}`,
		}));
		// A currency the list does not carry is still the current one.
		for (const code of [settings?.homeCurrency, settings?.defaultCurrency]) {
			if (code && !list.some((o) => o.value === code)) {
				list.push({ value: code, label: code });
			}
		}
		return list;
	})();

	async function save(
		patch: Parameters<NonNullable<typeof api>["settings"]["update"]>[0],
	) {
		if (!api) return;
		try {
			await api.settings.update(patch, {
				context: { idempotencyKey: newClientId() },
			});
			toast.show({ message: t("saved") });
			// The currencies are read from the session's profile, and every
			// cached figure was in the old home currency: read the profile again
			// and drop what was cached, so screens read it fresh when shown.
			if (patch.homeCurrency || patch.defaultCurrency) {
				await refreshMe();
				if (patch.homeCurrency) await local?.cache.clear();
			}
		} catch {
			toast.show({ message: t("saveError") });
		}
		general.reload();
	}

	async function setChannel(
		type: NotificationType,
		channel: "inApp" | "email",
		on: boolean,
	) {
		if (!api) return;
		const next = withChannel(prefs, type, channel, on);
		setPrefs(next);
		const changed = preferenceOf(next, type);
		if (!changed) return;
		try {
			await api.notifications.updatePreferences(
				{ preferences: [changed] },
				{ context: { idempotencyKey: newClientId() } },
			);
		} catch {
			toast.show({ message: t("saveError") });
			prefsRead.reload();
		}
	}

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			<Form>
				{me ? (
					<FormSection title={t("profile.title")}>
						<FormValueRow
							label={t("profile.name")}
							onPress={() => setEditing(true)}
							value={me.name}
						/>
						<FormValueRow
							label={t("profile.username")}
							onPress={() => setEditing(true)}
							value={`@${me.username}`}
						/>
						<FormValueRow label={t("profile.email")} value={me.email} />
					</FormSection>
				) : null}
				<FormSection footer={t("device.footer")} title={t("device.title")}>
					<FormPickerRow<LanguagePref>
						label={t("language.label")}
						onChange={setLanguagePref}
						options={languageOptions}
						value={language}
					/>
				</FormSection>
				{settings ? (
					<FormSection footer={t("money.footer")} title={t("money.title")}>
						<FormPickerRow
							label={t("money.home")}
							onChange={(homeCurrency) => save({ homeCurrency })}
							options={currencyOptions}
							value={settings.homeCurrency}
						/>
						<FormPickerRow
							label={t("money.default")}
							onChange={(defaultCurrency) => save({ defaultCurrency })}
							options={currencyOptions}
							value={settings.defaultCurrency}
						/>
						<FormPickerRow
							label={t("money.monthStart")}
							onChange={(day) => save({ fiscalMonthStartDay: Number(day) })}
							options={MONTH_START_DAYS.map((d) => ({
								value: String(d),
								label: String(d),
							}))}
							value={String(settings.fiscalMonthStartDay)}
						/>
					</FormSection>
				) : null}
				<FormSection footer={t("rates.footer")} title={t("rates.section")}>
					<FormValueRow
						label={t("rates.defaultType")}
						value={t("notAvailable")}
					/>
					<FormValueRow
						label={t("rates.pinned")}
						onPress={() => setShowRates(true)}
						value={String(pinned.length)}
					/>
				</FormSection>
				{prefs.length > 0 ? (
					<>
						<FormSection title={t("notifications.inApp")}>
							{INBOX_NOTIFICATION_TYPES.filter((type) =>
								preferenceOf(prefs, type),
							).map((type) => (
								<FormSwitchRow
									key={type}
									label={tn(type)}
									onChange={(on) => setChannel(type, "inApp", on)}
									value={preferenceOf(prefs, type)?.inApp ?? false}
								/>
							))}
						</FormSection>
						<FormSection title={t("notifications.email")}>
							{INBOX_NOTIFICATION_TYPES.filter((type) =>
								preferenceOf(prefs, type),
							).map((type) => (
								<FormSwitchRow
									key={type}
									label={tn(type)}
									onChange={(on) => setChannel(type, "email", on)}
									value={preferenceOf(prefs, type)?.email ?? false}
								/>
							))}
						</FormSection>
					</>
				) : null}
				<FormSection
					footer={t("server.changeFooter")}
					title={t("server.title")}
				>
					<FormValueRow label={t("server.connected")} value={server} />
					<FormActionRow
						label={t("server.change")}
						onPress={confirmChangeServer}
					/>
				</FormSection>
				<FormSection title={t("account.title")}>
					<FormActionRow
						label={t("account.signOut")}
						onPress={confirmSignOut}
					/>
					<FormActionRow
						destructive
						label={t("account.delete")}
						onPress={() => setDeleting(true)}
					/>
				</FormSection>
			</Form>
			{me ? (
				<ProfileSheet
					onClose={() => setEditing(false)}
					onSaved={() => {
						profile.reload();
					}}
					profile={me}
					visible={editing}
				/>
			) : null}
			<DeleteAccountSheet
				onClose={() => setDeleting(false)}
				visible={deleting}
			/>
			<RatesSheet
				onChanged={rates.reload}
				onClose={() => setShowRates(false)}
				rates={pinned}
				visible={showRates}
			/>
		</View>
	);
}
