import { Alert } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";

/**
 * Sign out, asking first when changes made on this phone have not synced
 * yet: signing out drops them. Shared by the account sheet and Settings.
 * `afterSignOut` runs once the session has ended (Settings uses it to forget
 * the server, so Change server never leaves a session behind).
 */
export function useSignOut(afterSignOut?: () => Promise<void> | void) {
	const t = useTranslations("mobile.account");
	const tc = useTranslations("mobile.common");
	const { signOut, unsyncedCount } = useSession();
	const finish = async (options?: { discardUnsynced?: boolean }) => {
		await signOut(options);
		await afterSignOut?.();
	};
	return async () => {
		const count = await unsyncedCount();
		if (count === 0) {
			await finish();
			return;
		}
		Alert.alert(t("signOut"), t("unsynced", { count }), [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("signOutDiscard"),
				style: "destructive",
				onPress: () => finish({ discardUnsynced: true }),
			},
		]);
	};
}
