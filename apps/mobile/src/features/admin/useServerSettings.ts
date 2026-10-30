import type { RetrospendClient } from "@retrospend/api-client";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";
import type { ServerSettings } from "./types";
import { detailOf, useAdminRead } from "./useAdminRead";

type Patch = Parameters<RetrospendClient["admin"]["updateSettings"]>[0];

/**
 * The server settings and a way to change one. A change shows at once, goes
 * to the server, and says so in a toast; when the server refuses, the page
 * reads the settings again so the switch goes back to what is true.
 */
export function useServerSettings() {
	const t = useTranslations("mobile.admin");
	const { api } = useSession();
	const toast = useToast();
	const { state, reload, patch } = useAdminRead((client) =>
		client.admin.getSettings(),
	);

	async function save(change: Patch) {
		if (!api) return;
		patch((current: ServerSettings) => ({ ...current, ...change }));
		try {
			const saved = await api.admin.updateSettings(change, {
				context: { idempotencyKey: newClientId() },
			});
			patch(() => saved);
			toast.show({ message: t("saved") });
		} catch (error) {
			toast.show({ message: detailOf(error) ?? t("saveError") });
			await reload();
		}
	}

	return { state, save, reload };
}
