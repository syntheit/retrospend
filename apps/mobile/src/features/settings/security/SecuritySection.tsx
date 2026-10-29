import { router } from "expo-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { useSignOut } from "@/features/account/useSignOut";
import { ListGroup, ListRow } from "@/ui/List";
import { Block, GroupNote, NavEnd, SettingsPage } from "../parts";
import { hostOf } from "../source";
import { openWebPage } from "../webPages";
import { PasswordSheet } from "./PasswordSheet";

/** The web page two-factor is managed on. */
export const TWO_FACTOR_PAGE = "/settings#security";

/**
 * Security: the password (changed here; the server asks for the current
 * one), two-factor (its status here; turning it on or off and backup codes
 * stay on the web, where better-auth runs them, since a phone token cannot),
 * the signed-in devices, and this phone's own sign out and server.
 */
export function SecuritySection() {
	const t = useTranslations("mobile.settings.security");
	const ts = useTranslations("mobile.settings");
	const { state } = useSession();
	const { connection, disconnect } = useServerConnection();
	const confirmSignOut = useSignOut();
	// Settings is only open while signed in, so the server changes after the
	// session ends; the sign-in screen has the same action for the signed-out case.
	const confirmChangeServer = useSignOut(disconnect);
	const [changing, setChanging] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;

	return (
		<>
			<SettingsPage>
				<Block>
					<ListGroup>
						<ListRow
							end={<NavEnd />}
							onPress={() => setChanging(true)}
							title={t("changePassword")}
						/>
						{me ? (
							<ListRow
								end={
									<NavEnd value={me.twoFactorEnabled ? t("on") : t("off")} />
								}
								onPress={
									baseUrl
										? () => void openWebPage(baseUrl, TWO_FACTOR_PAGE)
										: undefined
								}
								sub={baseUrl ? t("twoFactorWeb") : undefined}
								title={t("twoFactor")}
							/>
						) : null}
						<ListRow
							end={<NavEnd />}
							onPress={() => router.push("/settings/sessions")}
							title={t("devices")}
						/>
					</ListGroup>
					<GroupNote>{t("footer")}</GroupNote>
				</Block>
				<Block title={ts("account.title")}>
					<ListGroup>
						<ListRow onPress={confirmSignOut} title={ts("account.signOut")} />
						{baseUrl ? (
							<ListRow
								onPress={confirmChangeServer}
								sub={hostOf(baseUrl)}
								title={ts("server.change")}
							/>
						) : null}
					</ListGroup>
					<GroupNote>{ts("server.changeFooter")}</GroupNote>
				</Block>
			</SettingsPage>
			<PasswordSheet onClose={() => setChanging(false)} visible={changing} />
		</>
	);
}
