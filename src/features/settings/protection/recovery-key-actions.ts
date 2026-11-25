// What the person can do with the recovery key on screen: copy it, save it as
// a file, print it. The text of the file is the shared builder's
// (recoveryKeyFileText in @retrospend/crypto/client), so the web and the phone
// write the same file. The browser parts are behind one small type so the
// sheet can be driven without a browser.
import {
	RECOVERY_KEY_FILE_NAME,
	type RecoveryFileLabels,
	randomBelow,
	recoveryKeyFileText,
} from "@retrospend/crypto/client";

/** A number below `below` from the browser's own randomness: which two groups the confirm step asks for. */
export const browserRandom = (below: number) =>
	randomBelow(
		{ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
		below,
	);

export type KeyActions = {
	copy: (keyText: string) => Promise<void>;
	download: (fileText: string) => void;
	print: (fileText: string) => void;
};

/**
 * Copies the key; false when the clipboard refuses (no permission, an
 * insecure page), so a caller never says "Copied" for a copy that did not
 * happen.
 */
export async function copyRecoveryKey(
	actions: Pick<KeyActions, "copy">,
	keyText: string,
): Promise<boolean> {
	try {
		await actions.copy(keyText);
		return true;
	} catch {
		return false;
	}
}

/** The words around the key in the saved file, the account's email and the instant the keys were made. */
export type KeyFile = {
	labels: RecoveryFileLabels;
	account: string;
	made: Date;
};

export function keyFileText(file: KeyFile, keyText: string): string {
	return recoveryKeyFileText(file.labels, {
		keyText,
		account: file.account,
		made: file.made,
	});
}

export const browserKeyActions: KeyActions = {
	copy: (keyText) => navigator.clipboard.writeText(keyText),
	download: (fileText) => {
		const url = URL.createObjectURL(
			new Blob([fileText], { type: "text/plain;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = RECOVERY_KEY_FILE_NAME;
		link.click();
		URL.revokeObjectURL(url);
	},
	print: (fileText) => {
		// A hidden frame holds only the file, so the page behind the sheet does not print.
		const frame = document.createElement("iframe");
		frame.setAttribute("aria-hidden", "true");
		frame.className = "fixed size-0 border-0";
		document.body.append(frame);
		const doc = frame.contentDocument;
		const view = frame.contentWindow;
		if (!doc || !view) {
			frame.remove();
			return;
		}
		const pre = doc.createElement("pre");
		pre.textContent = fileText;
		doc.body.append(pre);
		view.addEventListener("afterprint", () => frame.remove(), { once: true });
		view.print();
	},
};
