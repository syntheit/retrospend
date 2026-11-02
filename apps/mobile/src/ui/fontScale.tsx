import { createContext, type ReactNode, useContext } from "react";
import { PixelRatio, useWindowDimensions } from "react-native";

const FontScale = createContext<number | null>(null);

/**
 * The text size setting, read once for the whole app. Rows and buttons ask
 * `useFontScale` instead of each subscribing to the window's dimensions, so
 * a window change does not re-render every one of them.
 */
export function FontScaleProvider({ children }: { children: ReactNode }) {
	const { fontScale } = useWindowDimensions();
	return <FontScale.Provider value={fontScale}>{children}</FontScale.Provider>;
}

/** The current text scale (1 is the default size). */
export function useFontScale(): number {
	const scale = useContext(FontScale);
	return scale ?? PixelRatio.getFontScale();
}
