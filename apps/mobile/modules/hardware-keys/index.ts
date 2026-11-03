import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/** One Cmd shortcut: Cmd + `input`, listed under `title` in the overlay that shows while Cmd is held. */
export interface KeyCommand {
	id: string;
	input: string;
	title: string;
}

export interface KeyCommandEvent {
	id: string;
}

interface HardwareKeysNative {
	setCommands(commands: KeyCommand[]): void;
	keyboardConnected(): boolean;
	addListener(
		event: "onKeyCommand",
		listener: (event: KeyCommandEvent) => void,
	): { remove(): void };
	addListener(
		event: "onKeyboardChange",
		listener: (event: { connected: boolean }) => void,
	): { remove(): void };
}

/** The iOS module; null on Android and in tests. */
export const HardwareKeys =
	requireOptionalNativeModule<HardwareKeysNative>("HardwareKeys");

interface HardwareKeyboardNative {
	keyboardConnected(): boolean;
	addListener(
		event: "onKeyboardChange",
		listener: (event: { connected: boolean }) => void,
	): { remove(): void };
}

/** Whether a physical keyboard is connected: the iOS module, or Android's own; null in tests. */
export const HardwareKeyboard: HardwareKeyboardNative | null =
	Platform.OS === "ios"
		? HardwareKeys
		: requireOptionalNativeModule<HardwareKeyboardNative>(
				"RetrospendHardwareKeyboard",
			);
