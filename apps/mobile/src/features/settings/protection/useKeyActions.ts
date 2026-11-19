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
}: {
	keyText: string | null;
	account: string;
	setError: (words: string | null) => void;
}) {
	const t = useTranslations("protection");
	const toast = useToast();
	return {
		async copy() {
			if (!keyText) return;
			setError(null);
			try {
				await copyRecoveryKey(keyText);
				toast.show({ message: t("recoveryKey.copied") });
			} catch {
				setError(t("errors.failed"));
			}
		},
		async save() {
			if (!keyText) return;
			setError(null);
			try {
				const labels = {
					title: t("recoveryKey.fileTitle"),
					account: t("recoveryKey.fileAccount"),
					made: t("recoveryKey.fileMade"),
					key: t("recoveryKey.label"),
					keepSafe: t("recoveryKey.saveBody"),
				};
				if (!(await saveRecoveryKeyFile(labels, { keyText, account })))
					setError(t("errors.failed"));
			} catch {
				setError(t("errors.failed"));
			}
		},
	};
}
