import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { Animated, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { ADD_CONTROL } from "@/layout/destinations";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { useSurfaceLinks } from "@/surfaces/useSurfaceLinks";
import { useTheme } from "@/theme";
import { AddButton } from "@/ui/AddButton";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { useToastLift } from "@/ui/Toast";
import { tabBarFootprint } from "@/ui/tabBarMetrics";
import { useKeyboardShown } from "@/ui/useKeyboardShown";
import {
	type AddEntryApi,
	AddEntryContext,
	useAddEntry,
	useHideAddButton,
	useOptionalAddEntry,
} from "./addEntryContext";
import { EntryComposer } from "./EntryComposer";
import { replaceDraft } from "./replaceDraft";
import type { EntryMode } from "./types";
import { useOutboxFlush } from "./useOutboxFlush";

// The screenshot tour is required only when its variable is set, so Metro drops
// it from every other build (see check-release-bundle.sh).
const DevComposerTour: ComponentType<{ add: AddEntryApi }> | null = process.env
	.EXPO_PUBLIC_DEV_COMPOSE
	? require("@/dev/DevComposerTour").DevComposerTour
	: null;

export { useAddEntry, useHideAddButton, useOptionalAddEntry };

/**
 * Where "add" lives (IMPLEMENTATION S5). Phones float one button above the tab
 * bar (Liquid Glass on iOS 26, an M3 FAB on Android; five tabs leave no room
 * for a plus tab) and hide it while the keyboard is up. The iPad has a plus in
 * the top bar's toolbar (TopBar.ios). All open
 * the composer in a sheet with detents. A tap opens Expense at once; Income and
 * Transfer are the composer's mode row (and the iOS long press, or a link).
 * It also keeps the outbox flowing, since an entry added offline needs a
 * sender when the network returns.
 */
export function AddEntryProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("mobile.composer");
	const insets = useSafeAreaInsets();
	const theme = useTheme();
	const { space } = theme;
	const [open, setOpen] = useState<EntryMode | null>(null);
	// A prefill belongs to one opening; the counter remounts the composer when
	// a second share arrives while the first is still open (after asking, when
	// the first has unsaved changes).
	const [fill, setFill] = useState<{
		prefill?: ComposerPrefill;
		editId?: string;
		editShared?: boolean;
		pendingId?: string;
		count: number;
	}>({ count: 0 });
	useOutboxFlush();
	const keyboard = useKeyboardShown();
	const toastLift = useToastLift();
	const [hiders, setHiders] = useState(0);
	const hideButton = useCallback(() => {
		setHiders((n) => n + 1);
		return () => setHiders((n) => n - 1);
	}, []);

	const sheetSize = useSheetBodySize();

	// Whether the open composer holds unsaved changes: a new opening asks first.
	const dirty = useRef(false);
	const isOpen = useRef(false);
	isOpen.current = open !== null;
	const onDirtyChange = useCallback((next: boolean) => {
		dirty.current = next;
	}, []);

	const show = useCallback(
		(
			next: EntryMode = "expense",
			prefill?: ComposerPrefill,
			editId?: string,
			editShared?: boolean,
			pendingId?: string,
		) => {
			replaceDraft(
				isOpen.current && dirty.current,
				() => {
					dirty.current = false;
					setFill((f) => ({
						prefill,
						editId,
						editShared,
						pendingId,
						count: f.count + 1,
					}));
					setOpen(next);
				},
				{
					title: t("replaceDraft.title"),
					detail: t("replaceDraft.detail"),
					keep: t("replaceDraft.keep"),
					replace: t("replaceDraft.replace"),
				},
			);
		},
		[t],
	);
	const api = useMemo(
		() => ({
			open: (next?: EntryMode, prefill?: ComposerPrefill) =>
				show(next, prefill),
			edit: (entryId: string, kind?: "shared") =>
				show("expense", undefined, entryId, kind === "shared"),
			editPending: (clientId: string) =>
				show("expense", undefined, undefined, undefined, clientId),
			hideButton,
		}),
		[show, hideButton],
	);
	useSurfaceLinks(show);
	const close = useCallback(() => {
		dirty.current = false;
		setOpen(null);
	}, []);

	return (
		<AddEntryContext.Provider value={api}>
			{children}
			{DevComposerTour ? <DevComposerTour add={api} /> : null}
			{ADD_CONTROL === "floating" && !keyboard && hiders === 0 ? (
				<Animated.View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						right: space[4],
						// Above the bar: the iOS system bar, or the Android pill.
						bottom:
							insets.bottom +
							(Platform.OS === "android" ? space[3] : space[4]) +
							tabBarFootprint(theme),
						// Clear of the Undo toast while one shows.
						transform: [{ translateY: toastLift }],
					}}
				>
					<AddButton
						actions={[
							{
								id: "income",
								label: t("addIncome"),
								onPress: () => show("income"),
							},
							{
								id: "transfer",
								label: t("addTransfer"),
								onPress: () => show("transfer"),
							},
						]}
						label={t("addExpense")}
						onPress={() => show("expense")}
					/>
				</Animated.View>
			) : null}
			<Sheet
				detents={["large"]}
				dismiss="none"
				grouped
				onClose={close}
				visible={open !== null}
			>
				<View style={sheetSize}>
					{open ? (
						<EntryComposer
							editId={fill.editId}
							editShared={fill.editShared}
							pendingId={fill.pendingId}
							initialMode={open}
							key={fill.count}
							onDirtyChange={onDirtyChange}
							onDone={close}
							prefill={fill.prefill}
							surface
						/>
					) : null}
				</View>
			</Sheet>
		</AddEntryContext.Provider>
	);
}
