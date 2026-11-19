// What the person can do with the recovery key on screen: copy it, save it as
// a file, print it. The text of the file is the shared builder's
// (recoveryKeyFileText in @retrospend/crypto/client), so the web and the phone
// write the same file. The browser parts are behind one small type so the
// sheet can be driven without a browser.
import {
	type RecoveryFileLabels,
	recoveryKeyFileText,
} from "@retrospend/crypto/client";

export type KeyActions = {
	copy: (keyText: string) => Promise<void>;
	download: (fileText: string) => void;
	print: (fileText: string) => void;
};

/** A name that says what the file is and names no one. */
export const KEY_FILE_NAME = "retrospend-recovery-key.txt";

/** The words around the key in the saved file, and the account and date it was made for. */
export type KeyFile = {
	labels: RecoveryFileLabels;
	account: string;
	made: string;
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
		link.download = KEY_FILE_NAME;
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
