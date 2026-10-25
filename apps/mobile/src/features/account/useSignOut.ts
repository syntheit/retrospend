import { Alert } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";

/**
 * Sign out, asking first when changes made on this phone have not synced
 * yet: signing out drops them. Shared by the account sheet and Settings.
 */
export function useSignOut() {
	const t = useTranslations("mobile.account");
	const tc = useTranslations("mobile.common");
	const { signOut, unsyncedCount } = useSession();
	return async () => {
		const count = await unsyncedCount();
		if (count === 0) {
			signOut();
			return;
		}
		Alert.alert(t("signOut"), t("unsynced", { count }), [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("signOutDiscard"),
				style: "destructive",
				onPress: () => signOut({ discardUnsynced: true }),
			},
		]);
	};
}
