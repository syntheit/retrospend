import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** True while the software keyboard is up: the floating Add button and the tab bar step aside. */
export function useKeyboardShown(): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		const ios = Platform.OS === "ios";
		const show = Keyboard.addListener(
			ios ? "keyboardWillShow" : "keyboardDidShow",
			() => setShown(true),
		);
		const hide = Keyboard.addListener(
			ios ? "keyboardWillHide" : "keyboardDidHide",
			() => setShown(false),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);
	return shown;
}
