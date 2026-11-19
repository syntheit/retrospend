import { RECOVERY_KEY_FILE_NAME } from "@retrospend/crypto/client";
import * as Clipboard from "expo-clipboard";
import { AppState } from "react-native";
import {
	CLIPBOARD_MS,
	copyRecoveryKey,
	saveRecoveryKeyFile,
} from "./recoveryKeyActions";

// Copy and save of the recovery key: the clipboard is cleared a minute after
// a copy (only when it still holds the key), and the saved file is the shared
// builder's text, shared once and deleted when the share sheet closes.

const mockClipboard = { text: "" };
jest.mock("expo-clipboard", () => ({
	setStringAsync: jest.fn(async (text: string) => {
		mockClipboard.text = text;
	}),
	getStringAsync: jest.fn(async () => mockClipboard.text),
}));
const mockShare = jest.fn();
const mockAvailable = jest.fn();
jest.mock("expo-sharing", () => ({
	isAvailableAsync: () => mockAvailable(),
	shareAsync: (...args: unknown[]) => mockShare(...args),
}));
const mockFile = {
	uri: "file:///cache/exports/retrospend-recovery-key.txt",
	create: jest.fn(),
	write: jest.fn(),
};
const mockExportFile = jest.fn((_name: string) => mockFile);
const mockRemove = jest.fn();
jest.mock("../security/exportFiles", () => ({
	exportFile: (name: string) => mockExportFile(name),
	removeFile: (file: unknown) => mockRemove(file),
	shareThenDelete: async (
		file: unknown,
		share: (f: unknown) => Promise<void>,
	) => {
		try {
			await share(file);
		} finally {
			mockRemove(file);
		}
	},
}));

// The module listens for the app coming back once, at the first copy; the
// handler it registers is kept here for the tests that play a return.
let onAppState: ((state: string) => void) | null = null;
jest.spyOn(AppState, "addEventListener").mockImplementation(((
	_type: string,
	handler: (state: string) => void,
) => {
	onAppState = handler;
	return { remove: jest.fn() };
}) as unknown as typeof AppState.addEventListener);

const KEY = "000000-000000-000000-000000-000000-000000-000000-000000-00011C";

beforeEach(() => {
	jest.useFakeTimers();
	mockClipboard.text = "";
	mockShare.mockReset();
	mockAvailable.mockReset();
	mockAvailable.mockResolvedValue(true);
	mockRemove.mockReset();
	mockFile.create.mockReset();
	mockFile.write.mockReset();
	mockExportFile.mockClear();
});
afterEach(() => {
	jest.runOnlyPendingTimers();
	jest.useRealTimers();
});

describe("copyRecoveryKey", () => {
	it("puts the key on the clipboard and clears it after a minute", async () => {
		await copyRecoveryKey(KEY);
		expect(mockClipboard.text).toBe(KEY);
		await jest.advanceTimersByTimeAsync(CLIPBOARD_MS - 1);
		expect(mockClipboard.text).toBe(KEY);
		await jest.advanceTimersByTimeAsync(1);
		expect(mockClipboard.text).toBe("");
	});

	it("leaves the clipboard alone when the person copied something else", async () => {
		await copyRecoveryKey(KEY);
		mockClipboard.text = "milk and eggs";
		await jest.advanceTimersByTimeAsync(CLIPBOARD_MS);
		expect(mockClipboard.text).toBe("milk and eggs");
	});

	it("restarts the minute on a second copy", async () => {
		await copyRecoveryKey(KEY);
		await jest.advanceTimersByTimeAsync(40_000);
		await copyRecoveryKey(KEY);
		await jest.advanceTimersByTimeAsync(40_000);
		expect(mockClipboard.text).toBe(KEY);
		await jest.advanceTimersByTimeAsync(20_000);
		expect(mockClipboard.text).toBe("");
	});
});

describe("copyRecoveryKey, a suspended app", () => {
	// A suspended app runs no timers: the clock jumps and nothing fires.
	const suspend = (ms: number) => jest.setSystemTime(Date.now() + ms);

	it("clears the key when the app returns after the minute", async () => {
		await copyRecoveryKey(KEY);
		suspend(CLIPBOARD_MS);
		expect(mockClipboard.text).toBe(KEY);
		await jest.advanceTimersByTimeAsync(0);
		onAppState?.("active");
		await jest.advanceTimersByTimeAsync(0);
		expect(mockClipboard.text).toBe("");
	});

	it("keeps the key for a return before the minute, and for other states", async () => {
		await copyRecoveryKey(KEY);
		suspend(CLIPBOARD_MS - 1);
		onAppState?.("active");
		await jest.advanceTimersByTimeAsync(0);
		expect(mockClipboard.text).toBe(KEY);
		suspend(1);
		onAppState?.("background");
		await jest.advanceTimersByTimeAsync(0);
		expect(mockClipboard.text).toBe(KEY);
	});
});

describe("copyRecoveryKey, a clipboard that cannot be read", () => {
	it("clears anyway: the key must not stay", async () => {
		await copyRecoveryKey(KEY);
		jest
			.mocked(Clipboard.getStringAsync)
			.mockRejectedValueOnce(new Error("not allowed"));
		await jest.advanceTimersByTimeAsync(CLIPBOARD_MS);
		expect(mockClipboard.text).toBe("");
	});
});

describe("saveRecoveryKeyFile", () => {
	const labels = {
		title: "Retrospend recovery key",
		account: "Account",
		made: "Made",
		key: "Recovery key",
		keepSafe: "Keep it safe.",
	};

	it("writes the shared file text, shares it, then deletes the copy", async () => {
		// Midday UTC: the same calendar day in every zone the builder may use.
		jest.setSystemTime(new Date("2026-11-18T12:00:00Z"));
		const saved = await saveRecoveryKeyFile(labels, {
			keyText: KEY,
			account: "ana@example.com",
		});
		expect(saved).toBe(true);
		expect(mockFile.write).toHaveBeenCalledWith(
			[
				"Retrospend recovery key",
				"",
				"Account: ana@example.com",
				"Made: 2026-11-18",
				"",
				"Recovery key:",
				KEY,
				"",
				"Keep it safe.",
				"",
			].join("\n"),
		);
		expect(mockExportFile).toHaveBeenCalledWith(RECOVERY_KEY_FILE_NAME);
		expect(mockShare).toHaveBeenCalledWith(mockFile.uri, {
			mimeType: "text/plain",
			UTI: "public.plain-text",
		});
		expect(mockRemove).toHaveBeenCalledWith(mockFile);
	});

	it("writes nothing when the phone has no share sheet", async () => {
		mockAvailable.mockResolvedValue(false);
		const saved = await saveRecoveryKeyFile(labels, {
			keyText: KEY,
			account: "ana@example.com",
		});
		expect(saved).toBe(false);
		expect(mockExportFile).not.toHaveBeenCalled();
	});

	it("deletes the copy when the share sheet fails", async () => {
		mockShare.mockRejectedValue(new Error("closed"));
		await expect(
			saveRecoveryKeyFile(labels, { keyText: KEY, account: "a@b.c" }),
		).rejects.toThrow();
		expect(mockRemove).toHaveBeenCalledWith(mockFile);
	});

	it("never writes a key with a typo", async () => {
		await expect(
			saveRecoveryKeyFile(labels, {
				keyText: KEY.replace("00011C", "00011D"),
				account: "a@b.c",
			}),
		).rejects.toThrow();
		expect(mockShare).not.toHaveBeenCalled();
		expect(mockExportFile).not.toHaveBeenCalled();
	});
});
