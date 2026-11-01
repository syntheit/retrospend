import { Stack, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { adminAccess } from "@/features/admin/rules";
import { useFeedback } from "@/features/feedback/FeedbackProvider";
import { openWebPage } from "@/features/settings/webPages";
import { useOpenSettingsRoute } from "@/layout/settingsPath";
import { appBuild } from "@/lib/appVersion";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { useMyFace } from "./AccountTopBar";
import { useSignOut } from "./useSignOut";

/** Unread feedback for an admin, read each time the sheet opens. A failed read leaves no count. */
function useUnreadFeedback(admin: boolean): number {
	const { api } = useSession();
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (!admin || !api) return;
		let alive = true;
		void api.admin.listFeedback({ limit: 1 }).then(
			(r) => {
				if (alive) setCount(r.counts.unread);
			},
			() => undefined,
		);
		return () => {
			alive = false;
		};
	}, [admin, api]);
	return count;
}

/**
 * The account sheet's first page (account.html, phone): the sheet is titled
 * "Account" in its own bar, with Done at the end, and under that bar come
 * you (the card), the places that have no tab, the links, then Sign out and
 * the version. Places open inside the same sheet (`/account/...`), so the
 * bar's chevron returns here; the sheet itself is a native form sheet.
 */
export function AccountScreen() {
	const t = useTranslations("mobile.account");
	const tc = useTranslations("mobile.common");
	const { state } = useSession();
	const baseUrl = useServerBaseUrl();
	const confirmSignOut = useSignOut();
	const feedback = useFeedback();
	const open = useOpenSettingsRoute();
	const navigation = useNavigation();
	const { space } = useTheme();
	const me = state.status === "signedIn" ? state.me : null;
	const face = useMyFace();
	const admin = adminAccess(me) === "ok";
	const unreadFeedback = useUnreadFeedback(admin);

	/** Done closes the whole sheet, wherever it is. */
	const close = () => (navigation.getParent() ?? navigation).goBack();
	const web = (path: string) => () =>
		baseUrl ? void openWebPage(baseUrl, path) : undefined;
	const opensWeb = t("opensWeb");

	return (
		<>
			<Stack.Screen
				options={{
					title: t("title"),
					headerRight: () => (
						<TextAction label={tc("done")} onPress={close} />
					),
				}}
			/>
			<Screen flush>
				<View style={{ gap: space[6], paddingTop: space[2] }}>
					{me && face ? (
						<ListGroup>
							<ListRow
								accessibilityLabel={`${me.name}, ${t("profileHint")}`}
								chevron
								lead={<Avatar face={face} size="md" />}
								onPress={() => open("profile")}
								sub={me.username ? `@${me.username}` : me.email}
								title={me.name}
							/>
						</ListGroup>
					) : null}
					<View style={{ gap: space[2] }}>
						<Text
							accessibilityRole="header"
							style={{ paddingHorizontal: space[4] }}
							tone="fg3"
							variant="meta"
						>
							{t("goTo")}
						</Text>
						<ListGroup>
							<Place
								glyph="Coins"
								label={t("currencies")}
								onPress={() => open("currencies")}
							/>
							<Place
								glyph="Settings"
								label={t("settings")}
								onPress={() => open("settings")}
							/>
						</ListGroup>
					</View>
					{admin || me?.canInvite === true ? (
						<ListGroup>
							{admin ? (
								<Place
									glyph="Shield"
									label={t("admin")}
									onPress={() => open("admin")}
								/>
							) : null}
							<Place
								glyph="KeyRound"
								label={t("inviteCodes")}
								onPress={() => open(admin ? "admin-invites" : "invite-codes")}
							/>
							{admin ? (
								<Place
									end={
										unreadFeedback > 0 ? (
											<StatusText
												label={t("newCount", { count: unreadFeedback })}
												size="sm"
												tone="attention"
											/>
										) : undefined
									}
									glyph="Mail"
									label={t("feedbackInbox")}
									onPress={() => open("admin-feedback")}
								/>
							) : null}
						</ListGroup>
					) : null}
					<ListGroup>
						<Place
							glyph="MessageSquare"
							label={t("feedback")}
							onPress={() => {
								// The sheet leaves first, so it is not in the picture.
								close();
								feedback.open({ afterSheet: true });
							}}
						/>
						<Place
							glyph="BookOpen"
							label={t("docs")}
							onPress={web("/docs?from=app")}
							web={opensWeb}
						/>
						<Place
							glyph="FileText"
							label={t("releaseNotes")}
							onPress={web("/releases?from=app")}
							web={opensWeb}
						/>
					</ListGroup>
					<ListGroup>
						<Place
							glyph="LogOut"
							label={t("signOut")}
							onPress={() => {
								close();
								void confirmSignOut();
							}}
							plain
						/>
					</ListGroup>
					<Text style={{ textAlign: "center" }} tone="fg3" variant="small">
						{t("version", appBuild())}
					</Text>
				</View>
			</Screen>
		</>
	);
}

function Chevron() {
	const { color, size } = useTheme();
	return <Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />;
}

/** A place the sheet goes: the glyph on a neutral tile, the label, a chevron unless it is plain. */
function Place({
	glyph,
	label,
	onPress,
	web,
	plain,
	end,
}: {
	glyph: GlyphName;
	/** A count before the chevron ("3 new"). */
	end?: React.ReactNode;
	label: string;
	onPress: () => void;
	/** Said after the label when the row opens a page on the web. */
	web?: string;
	/** An action, not a place: no chevron (Sign out). */
	plain?: boolean;
}) {
	return (
		<ListRow
			accessibilityLabel={web ? `${label}, ${web}` : label}
			end={
				plain ? undefined : (
					<>
						{end}
						<Chevron />
					</>
				)
			}
			lead={<IconTile name={glyph} />}
			onPress={onPress}
			title={label}
		/>
	);
}
