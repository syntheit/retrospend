import { Stack } from "expo-router";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslations } from "use-intl";
import { useHideAddButton } from "@/features/entry/addEntryContext";
import { useCollapsingBar } from "@/ui/barScroll";
import { SearchPill } from "@/ui/SearchPill";
import { SearchView } from "@/ui/SearchView";
import type { TopBarAction } from "@/ui/types";
import { useBackConsumer } from "./backConsumers";
import { useSearchOpener, useSearchShortcut } from "./searchShortcut";

/**
 * The search of a tab's list as the first icon of the top bar, so every tab
 * reads the same left to right: search, the page's own icons, then the account
 * button.
 *
 * On iOS and on Android's pushed pages the system's search bar is only mounted
 * while searching: its own icon would sit after the account button (Android
 * always, iOS 26 in the toolbar). Pressing the icon mounts the bar focused;
 * Cancel (iOS) or the close arrow (Android) takes it away and clears the text.
 *
 * On an Android tab root (the collapsing bar) there is no system bar to host
 * it, so the search is Material 3's: the icon, or `pill` (a search bar under
 * the title, for lists that have one) opens the full screen expanded view,
 * which `view(results)` draws with the screen's results. With the pill the
 * icon waits in the bar until the pill has scrolled away, so one search shows
 * at a time.
 *
 * `owner` is false for a list inside a hub that holds the bar (see
 * useSearchShortcut); `enabled` is false where the wide layout has no bar.
 */
export function useHeaderSearch({
	placeholder,
	onChange,
	enabled = true,
	owner = true,
	pill = false,
}: {
	placeholder: string;
	onChange: (text: string) => void;
	enabled?: boolean;
	owner?: boolean;
	/** Android tab roots: a search bar on the page too (Activity, People). */
	pill?: boolean;
}): {
	action: TopBarAction | null;
	/** The system search bar (iOS, pushed pages); null where `view` draws it. */
	screen: React.ReactElement | null;
	/** Android tab roots: the search bar for the page, null elsewhere or when `pill` is off. */
	pill: ReactElement | null;
	/**
	 * What the screen renders for the search: the system bar's screen, or on an
	 * Android tab root the expanded view over `results` (the screen's list with
	 * the query applied).
	 */
	view: (results: ReactNode) => ReactElement | null;
	/** The bar the Cmd+F shortcut reaches: the header's, or the wide layout's own field. */
	ref: ReturnType<typeof useSearchShortcut>;
} {
	const t = useTranslations("mobile.tabs");
	const ref = useSearchShortcut(owner);
	const expanded = useCollapsingBar() !== null;
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const openRef = useRef(open);
	openRef.current = open;
	// The add button would float over the full screen view.
	useHideAddButton(expanded && open);
	// The system search bar closes on Back before the page pops.
	useBackConsumer(enabled && open && !expanded);

	const show = useCallback(() => {
		if (openRef.current) {
			ref.current?.focus();
			return;
		}
		setOpen(true);
		// The bar mounts on the next render; focus it once it has.
		if (focusTimer.current) clearTimeout(focusTimer.current);
		focusTimer.current = setTimeout(() => ref.current?.focus(), 150);
	}, [ref]);
	useEffect(
		() => () => {
			if (focusTimer.current) clearTimeout(focusTimer.current);
		},
		[],
	);
	const close = useCallback(() => {
		setOpen(false);
		setText("");
		onChange("");
	}, [onChange]);
	const type = useCallback(
		(next: string) => {
			setText(next);
			onChange(next);
		},
		[onChange],
	);
	useSearchOpener(show);

	if (!enabled) {
		return { action: null, screen: null, pill: null, view: () => null, ref };
	}
	const screen =
		open && !expanded ? (
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
		) : null;
	return {
		ref,
		action: {
			id: "search",
			icon: "Search",
			label: t("search"),
			onPress: show,
			revealOnCollapse: expanded && pill,
		},
		screen,
		pill:
			expanded && pill ? (
				<SearchPill label={placeholder} onPress={show} />
			) : null,
		view: (results) =>
			expanded ? (
				<SearchView
					commands={ref}
					onChange={type}
					onClose={close}
					open={open}
					placeholder={placeholder}
					value={text}
				>
					{results}
				</SearchView>
			) : (
				screen
			),
	};
}
