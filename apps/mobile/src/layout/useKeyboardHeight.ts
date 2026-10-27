import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * The height of the on-screen keyboard, 0 while it is hidden. iOS reports it
 * before the animation (will events); Android only after (did events).
 */
export function useKeyboardHeight(enabled = true): number {
	const [height, setHeight] = useState(0);
	useEffect(() => {
		if (!enabled) return;
		const ios = Platform.OS === "ios";
		const show = Keyboard.addListener(
			ios ? "keyboardWillShow" : "keyboardDidShow",
			(event) => setHeight(event.endCoordinates.height),
		);
		const hide = Keyboard.addListener(
			ios ? "keyboardWillHide" : "keyboardDidHide",
			() => setHeight(0),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, [enabled]);
	return enabled ? height : 0;
}
