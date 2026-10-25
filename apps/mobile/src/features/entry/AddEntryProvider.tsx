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
/** The share of the screen the composer sheet takes. */
const SHEET_SHARE = 0.88;

export function useAddEntry(): AddEntryApi {
	const value = useContext(AddEntryContext);
	if (!value) throw new Error("useAddEntry needs an AddEntryProvider above it");
	return value;
}

/**
 * Where "add" lives on each device (IMPLEMENTATION S5). iPhone: the tab bar's
 * own plus selects the Add tab, so `open` only navigates there. Android: the
 * extended FAB, with Add income in its menu, and the composer as an M3 bottom
 * sheet. iPad: a glass plus and the composer as a sheet. It also keeps the
 * outbox flowing, since an entry added offline needs a sender when the
 * network returns.
 */
export function AddEntryProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("mobile.entry");
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { height } = useWindowDimensions();
	const { space } = useTheme();
	const [sheet, setSheet] = useState<{ mode: EntryMode } | null>(null);
	const [mode, setMode] = useState<EntryMode>("expense");
	const iPhone = Platform.OS === "ios" && !Platform.isPad;
	useOutboxFlush();

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
					<AddButton
						actions={
							Platform.OS === "android"
								? [
										{
											id: "income",
											label: t("addIncome"),
											onPress: () => open("income"),
										},
									]
								: undefined
						}
						label={t("addExpense")}
						onPress={() => open("expense")}
					/>
				</View>
			)}
			{iPhone ? null : (
				<Sheet
					detents={["large"]}
					onClose={close}
					title={mode === "expense" ? t("titleExpense") : t("titleIncome")}
					visible={sheet !== null}
				>
					<View style={{ height: Math.round(height * SHEET_SHARE) }}>
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
