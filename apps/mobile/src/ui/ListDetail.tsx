import { createContext, type ReactNode, type Ref, useContext } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "./EmptyState";
import { HAIRLINE } from "./metrics";
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
 * True inside the list pane's bar of a list-detail pair. Only there does a top
 * bar draw its own PaneBar and hide the native one; a tab screen that is not
 * a pair (Home, Budget) keeps the native large title on a wide window too.
 */
const InPair = createContext(false);

export function useInPair(): boolean {
	return useContext(InPair);
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
			// The list comes first: the system finds the scroll view that drives the
			// large title and the search bar through the first child of each view
			// down the screen, and the bar's account sheet is a native view that
			// would stand in front of it and leave the title and search stuck while
			// the rows scroll under them.
			<View style={{ flex: 1 }}>
				{list}
				{bar}
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
			<SidesCleared.Provider value>
				<View
					style={{
						width: LIST_WIDTH,
						borderRightWidth: HAIRLINE,
						borderRightColor: color.line,
					}}
				>
					<InPair.Provider value>{bar}</InPair.Provider>
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
				<View style={{ flex: 1 }}>{detail}</View>
			</SidesCleared.Provider>
		</SafeAreaView>
	);
}

/** The detail pane before a row is picked: one centered line. */
export function EmptyDetail({ title }: { title: string }) {
	return (
		<View style={{ flex: 1, justifyContent: "center" }}>
			<EmptyState title={title} />
		</View>
	);
}
