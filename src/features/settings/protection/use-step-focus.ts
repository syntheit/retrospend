import { type RefObject, useEffect } from "react";

/** The step that held focus is gone: focus lands on the new step's first control. */
export function useStepFocus(
	body: RefObject<HTMLElement | null>,
	step: string,
) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on a step change only
	useEffect(() => {
		body.current
			?.querySelector<HTMLElement>("input, button:not([disabled])")
			?.focus({ preventScroll: true });
	}, [step]);
}
