import type { ReactNode } from "react";
import { View } from "react-native";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";

const LIST_WIDTH = 360;

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
	return (
		<View style={{ flex: 1, flexDirection: "row" }}>
			<View
				style={{
					width: LIST_WIDTH,
					borderRightWidth: 1,
					borderRightColor: color.line,
				}}
			>
				{list}
			</View>
			<View style={{ flex: 1 }}>{detail}</View>
		</View>
	);
}
