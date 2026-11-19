import { useTranslations } from "use-intl";
import { useToast } from "@/ui/Toast";
import { copyRecoveryKey, saveRecoveryKeyFile } from "./recoveryKeyActions";

/**
 * Copy and Save for the key on screen. Both say the same words when they
 * cannot finish: the sheet's error line, never the system's text.
 */
export function useKeyActions({
	keyText,
	account,
	setError,
	session,
}: {
	keyText: string | null;
	account: string;
	setError: (words: string | null) => void;
	/** The sheet's session counter: it moves when the sheet closes, so an action started before is stale. */
	session: { current: number };
}) {
	const t = useTranslations("protection");
	const toast = useToast();
	return {
		async copy() {
			if (!keyText) return;
			const mine = session.current;
			setError(null);
			try {
				await copyRecoveryKey(keyText);
				if (mine === session.current)
					toast.show({ message: t("recoveryKey.copied") });
			} catch {
				// A failure after the sheet closed belongs to no screen now.
				if (mine === session.current) setError(t("errors.failed"));
			}
		},
		async save() {
			if (!keyText) return;
			const mine = session.current;
			setError(null);
			try {
				const labels = {
					title: t("recoveryKey.fileTitle"),
					account: t("recoveryKey.fileAccount"),
					made: t("recoveryKey.fileMade"),
					key: t("recoveryKey.label"),
					keepSafe: t("recoveryKey.saveBody"),
				};
				const saved = await saveRecoveryKeyFile(labels, { keyText, account });
				if (!saved && mine === session.current) setError(t("errors.failed"));
			} catch {
				if (mine === session.current) setError(t("errors.failed"));
			}
		},
	};
}
