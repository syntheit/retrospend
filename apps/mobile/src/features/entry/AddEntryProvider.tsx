import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Keyboard, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { ADD_CONTROL } from "@/layout/destinations";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import type { EntryMode } from "./ComposerShell";
import { EntryComposer } from "./EntryComposer";
import { useOutboxFlush } from "./useOutboxFlush";

interface AddEntryApi {
	/** Opens the composer sheet. */
	open(mode?: EntryMode): void;
}

const AddEntryContext = createContext<AddEntryApi | null>(null);

/** Height of the bar the floating button sits above: the M3 navigation bar, or the iOS tab bar. */
const BAR_HEIGHT = Platform.OS === "android" ? 80 : 49;
export function useAddEntry(): AddEntryApi {
	const value = useContext(AddEntryContext);
	if (!value) throw new Error("useAddEntry needs an AddEntryProvider above it");
	return value;
}

/** Like useAddEntry, but null outside a provider (the gallery has none). */
export function useOptionalAddEntry(): AddEntryApi | null {
	return useContext(AddEntryContext);
}

/** True while the software keyboard is up: the floating button steps aside. */
function useKeyboardShown(): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		const ios = Platform.OS === "ios";
		const show = Keyboard.addListener(
			ios ? "keyboardWillShow" : "keyboardDidShow",
			() => setShown(true),
		);
		const hide = Keyboard.addListener(
			ios ? "keyboardWillHide" : "keyboardDidHide",
			() => setShown(false),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);
	return shown;
}

/**
 * Where "add" lives (IMPLEMENTATION S5). Phones float one button above the tab
 * bar (Liquid Glass on iOS 26, an M3 FAB on Android; five tabs leave no room
 * for a plus tab) and hide it while the keyboard is up. The iPad has a plus in
 * the top bar's toolbar (TopBar.ios). All open
 * the composer in a sheet with detents (Income is the mode row inside it).
 * It also keeps the outbox flowing, since an entry added offline needs a
 * sender when the network returns.
 */
export function AddEntryProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("mobile.composer");
	const insets = useSafeAreaInsets();
	const { space } = useTheme();
	const [open, setOpen] = useState<EntryMode | null>(null);
	const [mode, setMode] = useState<EntryMode>("expense");
	useOutboxFlush();
	const keyboard = useKeyboardShown();

	const sheetSize = useSheetBodySize();

	const show = useCallback((next: EntryMode = "expense") => {
		setMode(next);
		setOpen(next);
	}, []);
	const api = useMemo(() => ({ open: show }), [show]);
	const close = useCallback(() => setOpen(null), []);

	return (
		<AddEntryContext.Provider value={api}>
			{children}
			{ADD_CONTROL === "floating" && !keyboard ? (
				<View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						right: space[4],
						bottom: insets.bottom + space[4] + BAR_HEIGHT,
					}}
				>
					<AddButton label={t("addExpense")} onPress={() => show("expense")} />
				</View>
			) : null}
			<Sheet
				detents={["large"]}
				onClose={close}
				title={mode === "expense" ? t("titleExpense") : t("titleIncome")}
				visible={open !== null}
			>
				<View style={sheetSize}>
					{open ? (
						<EntryComposer
							initialMode={open}
							onDone={close}
							onModeChange={setMode}
							surface
						/>
					) : null}
				</View>
			</Sheet>
		</AddEntryContext.Provider>
	);
}
