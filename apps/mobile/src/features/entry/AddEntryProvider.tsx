import { useRouter } from "expo-router";
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
	/** Opens the composer: the Add tab on iPhone, a sheet on iPad and Android. */
	open(mode?: EntryMode): void;
}

const AddEntryContext = createContext<AddEntryApi | null>(null);

/** Height of the Material 3 navigation bar the Android FAB floats above. */
const M3_NAVIGATION_BAR = 80;
/** The sheet's handle and title above the composer, plus its padding. */
const ANDROID_SHEET_CHROME = 112;
/** The share of the screen the iPad form sheet takes. */
const SHEET_SHARE = 0.88;

export function useAddEntry(): AddEntryApi {
	const value = useContext(AddEntryContext);
	if (!value) throw new Error("useAddEntry needs an AddEntryProvider above it");
	return value;
}

/**
 * Where "add" lives on each device (IMPLEMENTATION S5). iPhone: the tab bar's
 * own plus selects the Add tab, so `open` only navigates there. Android: the
 * extended FAB and the composer as an M3 bottom sheet (Income is the mode row
 * inside it). iPad: a glass plus and the composer as a sheet. It also keeps the
 * outbox flowing, since an entry added offline needs a sender when the
 * network returns.
 */
export function AddEntryProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("mobile.entry");
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { height, width } = useWindowDimensions();
	const { space } = useTheme();
	const [sheet, setSheet] = useState<{ mode: EntryMode } | null>(null);
	const [mode, setMode] = useState<EntryMode>("expense");
	const iPhone = Platform.OS === "ios" && !Platform.isPad;
	useOutboxFlush();

	// The Compose sheet gives its content the window's width without its own
	// side padding, and runs under the status and gesture bars.
	const sheetSize =
		Platform.OS === "android"
			? {
					width: width - 2 * space[4],
					height: Math.round(
						height - insets.top - insets.bottom - ANDROID_SHEET_CHROME,
					),
				}
			: { height: Math.round(height * SHEET_SHARE) };

	const open = useCallback(
		(next: EntryMode = "expense") => {
			if (iPhone) {
				router.navigate({ pathname: "/add", params: { mode: next } });
				return;
			}
			setMode(next);
			setSheet({ mode: next });
		},
		[iPhone, router],
	);
	const api = useMemo(() => ({ open }), [open]);
	const close = useCallback(() => setSheet(null), []);

	return (
		<AddEntryContext.Provider value={api}>
			{children}
			{iPhone ? null : (
				<View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						right: space[4],
						bottom:
							insets.bottom +
							space[4] +
							(Platform.OS === "android" ? M3_NAVIGATION_BAR : 0),
					}}
				>
					<AddButton label={t("addExpense")} onPress={() => open("expense")} />
				</View>
			)}
			{iPhone ? null : (
				<Sheet
					detents={["large"]}
					onClose={close}
					title={mode === "expense" ? t("titleExpense") : t("titleIncome")}
					visible={sheet !== null}
				>
					<View style={sheetSize}>
						{sheet ? (
							<EntryComposer
								initialMode={sheet.mode}
								onDone={close}
								onModeChange={setMode}
							/>
						) : null}
					</View>
				</Sheet>
			)}
		</AddEntryContext.Provider>
	);
}
