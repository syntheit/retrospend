import { usePathname } from "expo-router";
import { type ComponentType, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar, useMyFace } from "@/features/account/AccountTopBar";
import { AdminHub } from "@/features/admin/AdminHub";
import { useFeedback } from "@/features/feedback/FeedbackProvider";
import {
	setErrorReportsPref,
	useErrorReportsPref,
} from "@/features/feedback/pref";
import {
	isAccountPath,
	useCloseAccountSheet,
	useOpenSettingsRoute,
} from "@/layout/settingsPath";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useLanguagePref } from "@/lib/language-pref";
import { LANGUAGE_NAMES } from "@/lib/locales";
import { usePush } from "@/push/PushProvider";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import type { GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { GroupItem, ListGroup, ListRow } from "@/ui/List";
import { ListDetail } from "@/ui/ListDetail";
import { PaneBar } from "@/ui/PaneBar";
import { SwitchRow } from "@/ui/SwitchRow";
import { adminAccess } from "../admin/rules";
import { channelsOn, type NotificationChannel } from "./channels";
import { CategoriesScreen } from "./categories/CategoriesScreen";
import { DangerSection } from "./DangerSection";
import { DataSection } from "./DataSection";
import { NotificationsSection } from "./NotificationsSection";
import { PaymentMethodsScreen } from "./payment/PaymentMethodsScreen";
import { PreferencesSection } from "./PreferencesSection";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./security/SecuritySection";
import { AboutFooter, Block, GroupNote, SettingsPage } from "./parts";
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

type Pane = SectionId | "admin";

/** The page each row shows in the detail pane (the same components the routes render). */
const PAGES: Record<Pane, ComponentType> = {
	profile: ProfileSection,
	preferences: PreferencesSection,
	categories: CategoriesScreen,
	"payment-methods": PaymentMethodsScreen,
	notifications: NotificationsSection,
	security: SecuritySection,
	data: DataSection,
	danger: DangerSection,
	admin: AdminHub,
};

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
export function SettingsScreen({ panes = false }: { panes?: boolean }) {
	const t = useTranslations("mobile.settings");
	// Panes: the sections beside the list on a tablet (the Settings tab).
	const { listDetail } = useLayoutClass();
	const pair = panes && listDetail;
	const [picked, setPicked] = useState<Pane>("profile");
	const open = useOpenSettingsRoute();
	const closeSheet = useCloseAccountSheet();
	const inAccount = isAccountPath(usePathname());
	const tr = useTranslations("mobile.settings.root");
	const tc = useTranslations("mobile.settings.notifications.channel");
	const ta = useTranslations("mobile.admin");
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
	const admin = adminAccess(signedIn);

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

	// In panes a row shows its page beside the list; otherwise it opens the page.
	const go = (id: Pane) => (pair ? setPicked(id) : open(id));
	const row = (id: Exclude<SectionId, "profile">) => (
		<ListRow
			chevron={!pair}
			key={id}
			lead={<IconTile name={TILES[id]} />}
			onPress={() => go(id)}
			selected={pair && picked === id}
			sub={subs[id]}
			title={titles[id]}
		/>
	);

	const list = (
		<SettingsPage>
			<ListGroup>
				<ListRow
					chevron={!pair}
					lead={face ? <Avatar face={face} /> : <IconTile name="User" />}
					onPress={() => go("profile")}
					selected={pair && picked === "profile"}
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
			{admin === "none" ? null : (
				<>
					<View style={{ height: space[6] }} />
					<ListGroup>
						<ListRow
							chevron={admin === "ok" && !pair}
							lead={<IconTile name="Shield" />}
							onPress={admin === "ok" ? () => go("admin") : undefined}
							selected={pair && picked === "admin"}
							sub={admin === "signIn" ? ta("signInAgain") : undefined}
							title={ta("title")}
						/>
					</ListGroup>
				</>
			)}
			<View style={{ height: space[6] }} />
			<Block>
				<ListGroup>
					<ListRow
						chevron
						lead={<IconTile name="MessageSquare" />}
						onPress={() => {
							// Inside the account sheet, the sheet leaves first: two native sheets never stack.
							if (inAccount) {
								closeSheet();
								feedback.open({ afterSheet: true });
							} else feedback.open();
						}}
						title={tf("title")}
					/>
					<GroupItem>
						<SwitchRow
							label={tf("errorReports")}
							onChange={setErrorReportsPref}
							value={errorReports}
						/>
					</GroupItem>
				</ListGroup>
				<GroupNote>{tf("errorReportsDetail")}</GroupNote>
			</Block>
			<View style={{ height: space[6] }} />
			<ListGroup>{row("danger")}</ListGroup>
			<AboutFooter />
		</SettingsPage>
	);

	if (!pair) return list;
	const Page = PAGES[picked];
	return (
		<ListDetail
			bar={<AccountTopBar title={t("title")} />}
			detail={
				<View style={{ flex: 1 }}>
					<PaneBar
						title={
							picked === "profile"
								? t("profile.title")
								: picked === "admin"
									? ta("title")
									: titles[picked]
						}
					/>
					<Page />
				</View>
			}
			list={list}
		/>
	);
}
