import type { RetrospendClient } from "@retrospend/api-client";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";

type Patch = Parameters<RetrospendClient["settings"]["update"]>[0];

/**
 * Saves one general setting at once and says so in a toast. A home or
 * default currency change reads the profile again (the session carries the
 * currencies), and a new home currency drops what was cached, since every
 * cached figure was in the old one. `onSaved` runs after the server's answer,
 * saved or not, so the page reads the settings again.
 */
export function useSaveSettings(onSaved: () => void) {
	const t = useTranslations("mobile.settings");
	const { api, local, refreshMe } = useSession();
	const toast = useToast();
	return async function save(patch: Patch) {
		if (!api) return;
		try {
			await api.settings.update(patch, {
				context: { idempotencyKey: newClientId() },
			});
			toast.show({ message: t("saved") });
			// numberFormat null means "follow the language", so test the key.
			if (
				patch.homeCurrency ||
				patch.defaultCurrency ||
				"numberFormat" in patch
			) {
				await refreshMe();
				if (patch.homeCurrency) await local?.cache.clear();
			}
		} catch {
			toast.show({ message: t("saveError") });
		}
		onSaved();
	};
}
