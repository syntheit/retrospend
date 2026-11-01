import { Stack } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { TopBarAction } from "@/ui/types";
import { useSearchOpener, useSearchShortcut } from "./searchShortcut";

/**
 * The search of a tab's list as the first icon of the top bar, so every tab
 * reads the same left to right: search, the page's own icons, then the account
 * button. The system's search bar is only mounted while searching: its own
 * icon would sit after the account button (Android always, iOS 26 in the
 * toolbar). Pressing the icon mounts the bar focused; Cancel (iOS) or the
 * close arrow (Android) takes it away and clears the text.
 *
 * `owner` is false for a list inside a hub that holds the bar (see
 * useSearchShortcut); `enabled` is false where the wide layout has no bar.
 */
export function useHeaderSearch({
	placeholder,
	onChange,
	enabled = true,
	owner = true,
}: {
	placeholder: string;
	onChange: (text: string) => void;
	enabled?: boolean;
	owner?: boolean;
}): {
	action: TopBarAction | null;
	screen: React.ReactElement | null;
	/** The bar the Cmd+F shortcut reaches: the header's, or the wide layout's own field. */
	ref: ReturnType<typeof useSearchShortcut>;
} {
	const t = useTranslations("mobile.tabs");
	const ref = useSearchShortcut(owner);
	const [open, setOpen] = useState(false);
	const openRef = useRef(open);
	openRef.current = open;

	const show = useCallback(() => {
		if (openRef.current) {
			ref.current?.focus();
			return;
		}
		setOpen(true);
		// The bar mounts on the next render; focus it once it has.
		setTimeout(() => ref.current?.focus(), 150);
	}, [ref]);
	const close = useCallback(() => {
		setOpen(false);
		onChange("");
	}, [onChange]);
	useSearchOpener(show);

	if (!enabled) return { action: null, screen: null, ref };
	return {
		ref,
		action: {
			id: "search",
			icon: "Search",
			label: t("search"),
			onPress: show,
		},
		screen: open ? (
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						ref,
						placeholder,
						autoFocus: true,
						onChangeText: (event) => onChange(event.nativeEvent.text),
						onCancelButtonPress: close,
						onClose: close,
					},
				}}
			/>
		) : null,
	};
}
