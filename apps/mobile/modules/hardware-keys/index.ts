import { requireOptionalNativeModule } from "expo";

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
	addListener(
		event: "onKeyCommand",
		listener: (event: KeyCommandEvent) => void,
	): { remove(): void };
}

/** The iOS module; null on Android and in tests. */
export const HardwareKeys =
	requireOptionalNativeModule<HardwareKeysNative>("HardwareKeys");
