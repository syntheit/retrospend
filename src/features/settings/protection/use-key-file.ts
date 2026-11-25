import { useTranslations } from "next-intl";
import type { KeyFile } from "./recovery-key-actions";

/** The saved file's words (from the catalog), the account's email and the instant the key was made. */
export function useKeyFile(account: string, made: Date): KeyFile {
	const rk = useTranslations("protection.recoveryKey");
	return {
		labels: {
			title: rk("fileTitle"),
			account: rk("fileAccount"),
			made: rk("fileMade"),
			key: rk("label"),
			keepSafe: rk("saveBody"),
		},
		account,
		made,
	};
}
