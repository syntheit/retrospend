import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { ADD_CONTROL } from "@/layout/destinations";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { useSurfaceLinks } from "@/surfaces/useSurfaceLinks";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import type { EntryMode } from "./ComposerShell";
import { EntryComposer } from "./EntryComposer";
import { useOutboxFlush } from "./useOutboxFlush";

interface AddEntryApi {
	/** Opens the composer sheet, optionally filled in by a share, a Shortcut or a link. */
	open(mode?: EntryMode, prefill?: ComposerPrefill): void;
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

/**
 * Where "add" lives (IMPLEMENTATION S5). The iPhone has the system's detached
 * plus at the end of the tab bar (Tabs.tsx), which calls `open`. Android has
 * no such slot (the extended FAB floats above the M3 navigation bar), nor has
 * an iPhone below iOS 26 (the same button floats above the tab bar), and the
 * iPad has a plus in the top bar's toolbar (TopBar.ios). All open
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
	// A prefill belongs to one opening; the counter remounts the composer when
	// a second share arrives while the first is still open.
	const [fill, setFill] = useState<{
		prefill?: ComposerPrefill;
		count: number;
	}>({ count: 0 });
	useOutboxFlush();

	const sheetSize = useSheetBodySize();

	const show = useCallback(
		(next: EntryMode = "expense", prefill?: ComposerPrefill) => {
			setMode(next);
			setFill((f) => ({ prefill, count: f.count + 1 }));
			setOpen(next);
		},
		[],
	);
	const api = useMemo(() => ({ open: show }), [show]);
	useSurfaceLinks(show);
	const close = useCallback(() => setOpen(null), []);

	return (
		<AddEntryContext.Provider value={api}>
			{children}
			{ADD_CONTROL === "floating" ? (
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
							key={fill.count}
							onDone={close}
							onModeChange={setMode}
							prefill={fill.prefill}
							surface
						/>
					) : null}
				</View>
			</Sheet>
		</AddEntryContext.Provider>
	);
}
