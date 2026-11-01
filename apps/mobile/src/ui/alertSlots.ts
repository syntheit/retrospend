import type { AlertButton } from "react-native";

/**
 * What the Material 3 dialog's slots hold for the buttons a screen gave: the
 * cancel button at the start, the confirm (the one other button) at the end
 * and, for a plain choice with several answers (Take photo, Choose photo), the
 * answers listed in the body with Cancel in the confirm slot.
 */
export function dialogSlots(buttons: AlertButton[]): {
	cancel?: AlertButton;
	confirm?: AlertButton;
	choices: AlertButton[];
} {
	const cancel = buttons.find((b) => b.style === "cancel");
	const others = buttons.filter((b) => b !== cancel);
	if (others.length > 1) return { confirm: cancel, choices: others };
	return { cancel, confirm: others[0], choices: [] };
}
