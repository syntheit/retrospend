import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { Sheet } from "@/ui/Sheet";
import type { EntryMode } from "./ComposerShell";
import { EntryComposer } from "./EntryComposer";
import { useOutboxFlush } from "./useOutboxFlush";

interface AddEntryApi {
	/** Opens the composer sheet. */
	open(mode?: EntryMode): void;
}

const AddEntryContext = createContext<AddEntryApi | null>(null);

/** Height of the Material 3 navigation bar the Android button floats above. */
const M3_NAVIGATION_BAR = 80;
/** The sheet's handle and title above the composer, plus its padding. */
const SHEET_CHROME = Platform.OS === "ios" ? 76 : 112;
/** The share of the screen the iPad form sheet takes. */
const IPAD_SHEET_SHARE = 0.88;

export function useAddEntry(): AddEntryApi {
	const value = useContext(AddEntryContext);
	if (!value) throw new Error("useAddEntry needs an AddEntryProvider above it");
	return value;
}

/**
 * Where "add" lives (IMPLEMENTATION S5). iOS has the system's detached plus
 * at the end of the tab bar (Tabs.tsx), which calls `open`. Android has no
 * such slot: the extended FAB floats above the M3 navigation bar. Both open
 * the composer in a sheet with detents (Income is the mode row inside it).
 * It also keeps the outbox flowing, since an entry added offline needs a
 * sender when the network returns.
 */
export function AddEntryProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("mobile.composer");
	const insets = useSafeAreaInsets();
	const { height, width } = useWindowDimensions();
	const { space } = useTheme();
	const [open, setOpen] = useState<EntryMode | null>(null);
	const [mode, setMode] = useState<EntryMode>("expense");
	const iPad = Platform.OS === "ios" && Platform.isPad;
	useOutboxFlush();

	// The sheet gives its content the window's width without its own side
	// padding, and on phones runs under the status and gesture bars.
	const sheetSize = iPad
		? { height: Math.round(height * IPAD_SHEET_SHARE) }
		: {
				width: width - 2 * space[4],
				height: Math.round(height - insets.top - insets.bottom - SHEET_CHROME),
			};

	const show = useCallback((next: EntryMode = "expense") => {
		setMode(next);
		setOpen(next);
	}, []);
	const api = useMemo(() => ({ open: show }), [show]);
	const close = useCallback(() => setOpen(null), []);

	return (
		<AddEntryContext.Provider value={api}>
			{children}
			{Platform.OS === "android" ? (
				<View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						right: space[4],
						bottom: insets.bottom + space[4] + M3_NAVIGATION_BAR,
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
