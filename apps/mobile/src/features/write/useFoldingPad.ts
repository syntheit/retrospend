import { useCallback, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { SYSTEM_PAD_SCALE } from "@/features/entry/ComposerFrame";
import { useSystemPad } from "@/layout/useHardwareKeyboard";

/**
 * The keypad's folding and the pager's page, the one rule of every keypad
 * screen: a pick, a swipe or a tap on a tab or a part of the line folds the
 * keys away once there is an amount, and tapping the amount brings them
 * back. At the largest text sizes the amount is a field on the system
 * keyboard, and folding lets that keyboard go. `setPadOpen` is the state of
 * whoever owns the keypad (an entry form owns its own).
 */
export function usePadFold(
	hasAmount: boolean,
	setPadOpen: (open: boolean) => void,
) {
	const { fontScale } = useWindowDimensions();
	const system = useSystemPad(fontScale, SYSTEM_PAD_SCALE);
	const [page, setPage] = useState(0);
	const fold = useCallback(() => {
		if (!hasAmount) return;
		setPadOpen(false);
		if (system) Keyboard.dismiss();
	}, [hasAmount, system, setPadOpen]);
	const goTo = (next: number) => {
		setPage(next);
		fold();
	};
	return { page, setPage, goTo, fold, system };
}

/**
 * A keypad screen that owns its keypad (a money sheet, Add recurring, Settle
 * up): `open` is whether the keys are up when it opens, and `requestKeypad`
 * brings them back.
 */
export function useFoldingPad(hasAmount: boolean, open = true) {
	const [padOpen, setPadOpen] = useState(open);
	const [typing, setTyping] = useState(false);
	const fold = usePadFold(hasAmount, setPadOpen);
	return {
		...fold,
		padOpen,
		setPadOpen,
		typing,
		setTyping,
		requestKeypad: () => setPadOpen(true),
	};
}
