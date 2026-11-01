import { AVATAR_MAX_BYTES } from "@retrospend/api-contract";
import { useState } from "react";

import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";
import { type AvatarSource, pickAvatar, readAvatar } from "./avatar";
import { showAlert } from "@/ui/alert";

/**
 * Your profile picture: pick one (camera or library, cropped square),
 * upload it, or remove it. After either, the session's profile is read again
 * so the account button, the account sheet and the composer's You row show
 * the new face, and `onChanged` reloads the Settings profile read. Each ends
 * with a toast. Removing asks first: the file is deleted on the server, so
 * there is nothing to undo.
 */
export function useAvatar(onChanged: () => void) {
	const t = useTranslations("mobile.settings.profile");
	const tc = useTranslations("mobile.common");
	const { api, refreshMe } = useSession();
	const toast = useToast();
	const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

	async function changed(message: string) {
		await refreshMe();
		onChanged();
		toast.show({ message });
	}

	async function pick(source: AvatarSource) {
		if (!api || busy) return;
		setBusy("upload");
		try {
			const picked = await pickAvatar(source);
			if (picked.status === "canceled") return;
			if (picked.status === "denied") {
				toast.show({ message: t("photoDenied") });
				return;
			}
			if (picked.status === "tooLarge") {
				toast.show({ message: t("photoTooLarge") });
				return;
			}
			const file = await readAvatar(picked.uri);
			if (file.size > AVATAR_MAX_BYTES) {
				toast.show({ message: t("photoTooLarge") });
				return;
			}
			await api.profile.setAvatar(
				{ file },
				{ context: { idempotencyKey: newClientId() } },
			);
			await changed(t("photoUpdated"));
		} catch {
			toast.show({ message: t("photoUploadFailed") });
		} finally {
			setBusy(null);
		}
	}

	async function remove() {
		if (!api) return;
		setBusy("remove");
		try {
			await api.profile.removeAvatar(undefined, {
				context: { idempotencyKey: newClientId() },
			});
			await changed(t("photoRemoved"));
		} catch {
			toast.show({ message: t("photoRemoveFailed") });
		} finally {
			setBusy(null);
		}
	}

	function confirmRemove() {
		if (busy) return;
		showAlert(t("removePhotoTitle"), undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("removePhotoConfirm"),
				style: "destructive",
				onPress: () => void remove(),
			},
		]);
	}

	return { busy, pick, confirmRemove };
}
