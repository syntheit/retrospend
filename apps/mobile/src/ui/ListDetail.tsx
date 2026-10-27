import { createContext, type ReactNode, useContext } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";

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
 */
export function ListDetail({
	list,
	detail,
}: {
	list: ReactNode;
	/** What the detail pane shows; the screen's empty state when nothing is picked. */
	detail: ReactNode;
}) {
	const { listDetail } = useLayoutClass();
	const { color } = useTheme();
	if (!listDetail) return <View style={{ flex: 1 }}>{list}</View>;
	// The iPad sidebar floats over the content; the list starts after it.
	return (
		<SafeAreaView
			edges={["left", "right"]}
			style={{ flex: 1, flexDirection: "row" }}
		>
			<View
				style={{
					width: LIST_WIDTH,
					borderRightWidth: 1,
					borderRightColor: color.line,
				}}
			>
				{list}
			</View>
			<SidesCleared.Provider value>
				<View style={{ flex: 1 }}>{detail}</View>
			</SidesCleared.Provider>
		</SafeAreaView>
	);
}
