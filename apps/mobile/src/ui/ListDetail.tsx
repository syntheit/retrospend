import { createContext, type ReactNode, type Ref, useContext } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { PaneSearch } from "./PaneBar";

const LIST_WIDTH = 360;

/**
 * True inside a list-detail pair: its row already cleared the sides (the iPad
 * sidebar, a notch), so a Screen in the detail pane must not clear them again.
 * The native SafeAreaView measures once from where its view starts, and the
 * pane it sits in has moved by then.
 */
const SidesCleared = createContext(false);

export function useSidesCleared(): boolean {
	return useContext(SidesCleared);
}

/**
 * List and detail for Activity, People and Projects. On iPad and expanded
 * Android windows the two sit side by side (the detail is the screen's empty
 * state until a row is picked); on a phone only the list shows, and the
 * screen pushes the detail as its own route.
 *
 * Each pane owns its bar. `bar` is the list's top bar (an AccountTopBar): on
 * a phone it sets the native navigation bar, and in a pair it draws the list
 * pane's title and toolbar and hides the native bar, which would span both
 * panes. `search` is the list's search: the native search bar on a phone, a
 * field in the list pane in a pair. The detail draws its own title.
 */
export function ListDetail({
	bar,
	search,
	list,
	detail,
}: {
	bar?: ReactNode;
	search?: {
		value: string;
		onChange: (text: string) => void;
		placeholder: string;
		ref?: Ref<SearchBarCommands | null>;
	};
	list: ReactNode;
	/** What the detail pane shows; the screen's empty state when nothing is picked. */
	detail: ReactNode;
}) {
	const { listDetail } = useLayoutClass();
	const { color } = useTheme();
	if (!listDetail) {
		return (
			<View style={{ flex: 1 }}>
				{bar}
				{list}
			</View>
		);
	}
	// The iPad sidebar floats over the content; the list starts after it. The
	// native bar is hidden, so the pair clears the top itself.
	return (
		<SafeAreaView
			edges={["top", "left", "right"]}
			style={{ flex: 1, flexDirection: "row" }}
		>
			<View
				style={{
					width: LIST_WIDTH,
					borderRightWidth: 1,
					borderRightColor: color.line,
				}}
			>
				{bar}
				{search ? (
					<PaneSearch
						onChange={search.onChange}
						placeholder={search.placeholder}
						searchRef={search.ref}
						value={search.value}
					/>
				) : null}
				{list}
			</View>
			<SidesCleared.Provider value>
				<View style={{ flex: 1 }}>{detail}</View>
			</SidesCleared.Provider>
		</SafeAreaView>
	);
}
