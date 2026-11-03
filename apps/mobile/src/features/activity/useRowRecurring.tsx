import { type ReactNode, useCallback, useState } from "react";
import { MakeRecurringSheet } from "@/features/recurring/MakeRecurringSheet";
import type { ActivityItem } from "./source";

/**
 * Make recurring from a list row: the sheet that shows what the template
 * will do lives once on the screen, and the row's menu opens it for its
 * entry. `open` is stable, so memoized rows keep it.
 */
export function useRowRecurring(onDone: () => void): {
	open: (item: ActivityItem) => void;
	sheet: ReactNode;
} {
	const [item, setItem] = useState<ActivityItem | null>(null);
	const [visible, setVisible] = useState(false);
	const open = useCallback((next: ActivityItem) => {
		setItem(next);
		setVisible(true);
	}, []);
	return {
		open,
		sheet: item ? (
			<MakeRecurringSheet
				item={item}
				onClose={() => setVisible(false)}
				onDone={onDone}
				visible={visible}
			/>
		) : null,
	};
}
