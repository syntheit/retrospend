import { useCallback, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { SYSTEM_PAD_SCALE } from "./ComposerFrame";

/**
 * The pager's page and the keypad's folding for a composer that has no
 * entry form (Add recurring, Settle up): the same rules as `usePanelFold`. A
 * pick, a swipe or a tap on a tab or a part of the line folds the keys away
 * once there is an amount; tapping the amount brings them back. At the
 * largest text sizes the amount is a field and folding lets its keyboard go.
 */
export function useLocalPad(options: { open: boolean; hasAmount: boolean }) {
	const { fontScale } = useWindowDimensions();
	const system = fontScale > SYSTEM_PAD_SCALE;
	const [page, setPage] = useState(0);
	const [padOpen, setPadOpen] = useState(options.open);
	const [typing, setTyping] = useState(false);
	const { hasAmount } = options;
	const fold = useCallback(() => {
		if (!hasAmount) return;
		setPadOpen(false);
		if (system) Keyboard.dismiss();
	}, [hasAmount, system]);
	const goTo = (next: number) => {
		setPage(next);
		fold();
	};
	return {
		page,
		goTo,
		fold,
		system,
		padOpen,
		setPadOpen,
		typing,
		setTyping,
		requestKeypad: () => setPadOpen(true),
	};
}
