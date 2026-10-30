import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { FeedbackSheet } from "./FeedbackSheet";
import { currentScreen } from "./runtime";
import { captureScreen, discardTempImage } from "./screenshot";

/** How long the account sheet takes to leave, so it is not in the picture. */
const SHEET_LEAVES_MS = 450;

interface FeedbackApi {
	/**
	 * Opens Send feedback. The screen is captured first, so the person can
	 * attach it. Pass `afterSheet` when a sheet is closing as this opens.
	 */
	open: (options?: { afterSheet?: boolean }) => void;
}

const FeedbackContext = createContext<FeedbackApi>({ open: () => undefined });

export function useFeedback(): FeedbackApi {
	return useContext(FeedbackContext);
}

/** Holds the one Send feedback sheet, so any screen can open it. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<{
		visible: boolean;
		captured: string | null;
		screen: string | undefined;
	}>({ visible: false, captured: null, screen: undefined });

	const open = useCallback(async (options?: { afterSheet?: boolean }) => {
		const screen = currentScreen();
		if (options?.afterSheet)
			await new Promise((resolve) => setTimeout(resolve, SHEET_LEAVES_MS));
		const captured = await captureScreen();
		setState({ visible: true, captured, screen });
	}, []);

	const value = useMemo<FeedbackApi>(
		() => ({ open: (options) => void open(options) }),
		[open],
	);

	return (
		<FeedbackContext.Provider value={value}>
			{children}
			<FeedbackSheet
				captured={state.captured}
				onClose={() => {
					// Sent or left: the capture is no longer needed.
					discardTempImage(state.captured);
					setState((s) => ({ ...s, visible: false, captured: null }));
				}}
				screen={state.screen}
				visible={state.visible}
			/>
		</FeedbackContext.Provider>
	);
}
