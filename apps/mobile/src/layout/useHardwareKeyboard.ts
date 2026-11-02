import { useEffect, useState } from "react";
import { HardwareKeyboard } from "../../modules/hardware-keys";
import { useLayoutClass } from "./useLayoutClass";

/**
 * True while a physical keyboard is connected. Without the native module
 * (tests) it is false.
 */
export function useHardwareKeyboard(): boolean {
	const [connected, setConnected] = useState(
		() => HardwareKeyboard?.keyboardConnected() ?? false,
	);
	useEffect(() => {
		if (!HardwareKeyboard) return;
		setConnected(HardwareKeyboard.keyboardConnected());
		const subscription = HardwareKeyboard.addListener(
			"onKeyboardChange",
			(event) => setConnected(event.connected),
		);
		return () => subscription.remove();
	}, []);
	return connected;
}

/**
 * The composer types the amount on the system keyboard instead of its
 * keypad: at the largest text sizes, and on a tablet with a hardware
 * keyboard, where an on-screen keypad is only in the way. Phones keep the
 * keypad whatever is plugged in.
 */
export function useSystemPad(fontScale: number, limit: number): boolean {
	const { tablet } = useLayoutClass();
	const hardware = useHardwareKeyboard();
	return fontScale > limit || (tablet && hardware);
}
