import { Alert } from "react-native";

/**
 * A share, a Quick Settings tile, a Control or a link can arrive while the
 * composer is open. An untouched composer is simply replaced; one with
 * unsaved changes asks first, and keeps them unless the person says Replace.
 */
export function replaceDraft(
	dirty: boolean,
	replace: () => void,
	words: { title: string; detail: string; keep: string; replace: string },
): void {
	if (!dirty) {
		replace();
		return;
	}
	Alert.alert(words.title, words.detail, [
		{ text: words.keep, style: "cancel" },
		{ text: words.replace, style: "destructive", onPress: replace },
	]);
}
