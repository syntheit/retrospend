import { useCallback, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { SYSTEM_PAD_SCALE } from "./ComposerFrame";
import type { EntryForm } from "./useEntryForm";

/**
 * The pager's page and the keypad's folding, shared by the Income and
 * Transfer screens: a pick in a panel, a swipe or a tap on a tab or a part of
 * the line folds the keys away once there is an amount to add, and tapping the
 * amount brings them back. At the largest text sizes the amount is a field
 * and folding lets its keyboard go.
 */
export function usePanelFold(form: EntryForm) {
	const { fontScale } = useWindowDimensions();
	const system = fontScale > SYSTEM_PAD_SCALE;
	const [page, setPage] = useState(0);
	const fold = useCallback(() => {
		if (form.typedAmount === null) return;
		form.setPadOpen(false);
		if (system) Keyboard.dismiss();
	}, [form, system]);
	const goTo = (next: number) => {
		setPage(next);
		fold();
	};
	return { page, goTo, fold, system };
}
