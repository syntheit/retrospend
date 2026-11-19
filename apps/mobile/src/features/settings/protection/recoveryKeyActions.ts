import {
	RECOVERY_KEY_FILE_NAME,
	type RecoveryFileLabels,
	recoveryKeyFileText,
} from "@retrospend/crypto/client";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { AppState } from "react-native";
import {
	exportFile,
	removeFile,
	shareThenDelete,
} from "../security/exportFiles";

/** How long the key stays on the clipboard. */
export const CLIPBOARD_MS = 60_000;

let wipe: {
	text: string;
	at: number;
	timer: ReturnType<typeof setTimeout>;
} | null = null;

/** Clears the clipboard if it still holds the key; a read that fails clears it anyway. */
async function clearIfHeld(text: string): Promise<void> {
	let held = true;
	try {
		held = (await Clipboard.getStringAsync()) === text;
	} catch {
		// Cannot tell what is there: the key must not stay, so clear.
	}
	if (held) await Clipboard.setStringAsync("");
}

function runWipe(): void {
	const pending = wipe;
	if (!pending) return;
	clearTimeout(pending.timer);
	wipe = null;
	clearIfHeld(pending.text).catch(() => undefined);
}

let listening = false;

// A suspended app runs no timers: when it comes back after the minute, the
// key is cleared then, before anything else can paste it.
function listenForReturn(): void {
	if (listening) return;
	listening = true;
	AppState.addEventListener("change", (state) => {
		if (state === "active" && wipe && Date.now() - wipe.at >= CLIPBOARD_MS)
			runWipe();
	});
}

/**
 * Puts the key on the clipboard and clears it again after a minute. A second
 * copy restarts the minute. The text is only held here while the clock runs.
 */
export async function copyRecoveryKey(text: string): Promise<void> {
	await Clipboard.setStringAsync(text);
	listenForReturn();
	if (wipe) clearTimeout(wipe.timer);
	wipe = { text, at: Date.now(), timer: setTimeout(runWipe, CLIPBOARD_MS) };
}

/**
 * Writes the recovery key file (the one text every platform saves) to the
 * cache and opens the share sheet, where it is saved to Files or the device.
 * The copy is deleted once the sheet closes. Resolves false when there is no
 * share sheet.
 */
export async function saveRecoveryKeyFile(
	labels: RecoveryFileLabels,
	file: { keyText: string; account: string },
): Promise<boolean> {
	// Built first: a key with a typo throws here and nothing is written.
	const text = recoveryKeyFileText(labels, {
		...file,
		made: new Date(),
	});
	if (!(await Sharing.isAvailableAsync())) return false;
	const target = exportFile(RECOVERY_KEY_FILE_NAME);
	try {
		target.create({ overwrite: true });
		target.write(text);
		await shareThenDelete(target, async (f) => {
			await Sharing.shareAsync(f.uri, {
				mimeType: "text/plain",
				UTI: "public.plain-text",
			});
		});
		return true;
	} catch (error) {
		removeFile(target);
		throw error;
	}
}
