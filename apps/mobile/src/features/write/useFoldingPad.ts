import { useCallback, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { SYSTEM_PAD_SCALE } from "@/features/entry/ComposerFrame";

/**
 * The keypad's folding for a money sheet that is not the composer: up when the
 * sheet opens, put away by a pick once there is an amount, back on a tap of
 * the amount. At the largest text sizes the amount is a field on the system
 * keyboard, and folding lets that keyboard go.
 */
export function useFoldingPad(hasAmount: boolean) {
	const { fontScale } = useWindowDimensions();
	const system = fontScale > SYSTEM_PAD_SCALE;
	const [padOpen, setPadOpen] = useState(true);
	const [typing, setTyping] = useState(false);
	const fold = useCallback(() => {
		if (!hasAmount) return;
		setPadOpen(false);
		if (system) Keyboard.dismiss();
	}, [hasAmount, system]);
	return { padOpen, setPadOpen, typing, setTyping, system, fold };
}
