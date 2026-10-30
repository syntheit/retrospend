import { router } from "expo-router";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMyFace } from "@/features/account/AccountTopBar";
import { useFeedback } from "@/features/feedback/FeedbackProvider";
import {
	setErrorReportsPref,
	useErrorReportsPref,
} from "@/features/feedback/pref";
import { useLanguagePref } from "@/lib/language-pref";
import { LANGUAGE_NAMES } from "@/lib/locales";
import { usePush } from "@/push/PushProvider";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import type { GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { channelsOn, type NotificationChannel } from "./channels";
import { AboutFooter, Block, GroupNote, NavEnd, SettingsPage } from "./parts";
import {
	useCategories,
	useGeneralSettings,
	useNotificationPreferences,
	usePaymentMethods,
	useProfile,
} from "./useSettings";

/** The sections, in the order the root lists them (settings.html, layout B). */
export type SectionId =
	| "profile"
	| "preferences"
	| "categories"
	| "payment-methods"
	| "notifications"
	| "security"
	| "data"
	| "danger";

const TILES: Record<Exclude<SectionId, "profile">, GlyphName> = {
	preferences: "SlidersHorizontal",
	categories: "Tags",
	"payment-methods": "CreditCard",
	notifications: "Bell",
	security: "ShieldCheck",
	data: "Download",
	danger: "TriangleAlert",
};

/**
 * Settings, as a list of its sections (layout B on the phone): a tile, the
 * name and a line that says where it stands, then a page per section. Every
 * line reads from what the phone already kept, so the list opens at once and
 * the lines fill in as the reads answer. Recurring expenses live in Activity,
 * not here. Delete account sits alone below, then the About footer.
 */
export function SettingsScreen() {
	const t = useTranslations("mobile.settings");
	const tr = useTranslations("mobile.settings.root");
	const tc = useTranslations("mobile.settings.notifications.channel");
	const { state } = useSession();
	const push = usePush();
	const face = useMyFace();
	const { space } = useTheme();
	const profile = useProfile();
	const general = useGeneralSettings();
	const categories = useCategories();
	const methods = usePaymentMethods();
	const prefsRead = useNotificationPreferences();
	const language = useLanguagePref();
	const feedback = useFeedback();
	const errorReports = useErrorReportsPref();
	const tf = useTranslations("mobile.feedback");

	const me = profile.state.status === "ready" ? profile.state.data : null;
	const settings = general.state.status === "ready" ? general.state.data : null;
	const signedIn = state.status === "signedIn" ? state.me : null;

	const languageName =
		language === "device" ? t("language.device") : LANGUAGE_NAMES[language];
	const channels = new Set<NotificationChannel>();
	if (prefsRead.state.status === "ready") {
		for (const pref of prefsRead.state.data.preferences) {
			for (const channel of channelsOn(pref, push.on)) channels.add(channel);
		}
	}
	const notifySub =
		prefsRead.state.status !== "ready"
			? undefined
			: channels.size > 0
				? (["inApp", "email", "push"] as const)
						.filter((channel) => channels.has(channel))
						.map((channel) => tc(channel))
						.join(", ")
				: t("notifications.none");

	const subs: Record<Exclude<SectionId, "profile">, string | undefined> = {
		preferences: settings
			? `${settings.homeCurrency} · ${languageName}`
			: undefined,
		categories:
			categories.state.status === "ready"
				? tr("categories", { count: categories.state.data.length })
				: undefined,
		"payment-methods":
			methods.state.status === "ready"
				? tr("methods", { count: methods.state.data.length })
				: undefined,
		notifications: notifySub,
		security: signedIn
			? signedIn.twoFactorEnabled
				? tr("twoFactorOn")
				: tr("twoFactorOff")
			: undefined,
		data: tr("export"),
		danger: t("account.delete"),
	};
	const titles: Record<Exclude<SectionId, "profile">, string> = {
		preferences: tr("preferences"),
		categories: t("manage.categories"),
		"payment-methods": t("manage.payment"),
		notifications: tr("notifications"),
		security: t("security.title"),
		data: t("data.title"),
		danger: tr("danger"),
	};

	const row = (id: Exclude<SectionId, "profile">) => (
		<ListRow
			end={<NavEnd />}
			key={id}
			lead={<IconTile name={TILES[id]} />}
			onPress={() => router.push(`/settings/${id}`)}
			sub={subs[id]}
			title={titles[id]}
		/>
	);

	return (
		<SettingsPage>
			<Text
				style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}
				tone="fg3"
				variant="meta"
			>
				{t("autosave")}
			</Text>
			<ListGroup>
				<ListRow
					end={<NavEnd />}
					lead={face ? <Avatar face={face} /> : <IconTile name="User" />}
					onPress={() => router.push("/settings/profile")}
					sub={me?.name ?? signedIn?.name}
					title={t("profile.title")}
				/>
				{row("preferences")}
				{row("categories")}
				{row("payment-methods")}
				{row("notifications")}
				{row("security")}
				{row("data")}
			</ListGroup>
			<View style={{ height: space[6] }} />
			<Block>
				<ListGroup>
					<ListRow
						end={<NavEnd />}
						lead={<IconTile name="MessageSquare" />}
						onPress={() => feedback.open()}
						title={tf("title")}
					/>
					<ListRow>
						<View style={{ flex: 1 }}>
							<SwitchRow
								label={tf("errorReports")}
								onChange={setErrorReportsPref}
								value={errorReports}
							/>
						</View>
					</ListRow>
				</ListGroup>
				<GroupNote>{tf("errorReportsDetail")}</GroupNote>
			</Block>
			<View style={{ height: space[6] }} />
			<ListGroup>{row("danger")}</ListGroup>
			<AboutFooter />
		</SettingsPage>
	);
}
