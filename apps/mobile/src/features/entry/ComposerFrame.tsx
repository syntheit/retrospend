import type { ReactNode } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { DetailPager, type PagerTab } from "@/ui/DetailPager";
import { FoldingKeypad, type KeypadEntry } from "@/ui/FoldingKeypad";
import { SummaryLine, type SummaryPart } from "@/ui/SummaryLine";

/**
 * Above this text scale the keypad steps aside for the system decimal
 * keyboard: the amount is typed in its field and the one Add button stays
 * under the details.
 */
export const SYSTEM_PAD_SCALE = 1.5;

/** A window shorter than this (an iPhone SE, a short Android) gets 44 point keys. */
export const COMPACT_HEIGHT = 740;

/**
 * The composer's one screen, the same for an expense, an income and a
 * transfer: the head, the amount, the title, the answers so far as a line,
 * the tabs over the swiping panels, the one-line preview, and at the foot
 * the keypad that folds into one Add button. Only the content differs by
 * mode: the caller hands in the tabs and their panels.
 *
 * The top (everything above the foot) scrolls when the window is too short
 * for it, so no control is ever cut; the panel keeps at least 140 points.
 * Typing in a text field (the title, a note) swaps the keypad for the system
 * keyboard, and the keypad comes back when the field is left.
 */
export function ComposerFrame({
	header,
	amount,
	title,
	summary,
	tabs,
	page,
	onPageChange,
	panels,
	tabsLabel,
	changedLabel,
	preview,
	keypad,
	keypadOpen,
	typing,
	add,
	onKeypadOpen,
	onTab,
	surface,
}: {
	header: ReactNode;
	/** The amount block, with the rate line under it for another currency. */
	amount: ReactNode;
	/** The title field and what is known about the title. */
	title: ReactNode;
	summary: SummaryPart[];
	tabs: PagerTab[];
	page: number;
	onPageChange: (page: number, by: "tab" | "swipe") => void;
	panels: ReactNode[];
	tabsLabel: string;
	changedLabel: string;
	/** The one-line "what this changes". */
	preview: ReactNode;
	/** What the keypad types now. */
	keypad: KeypadEntry;
	/** The person wants the keys; a text field being typed in or a big text size overrides it. */
	keypadOpen: boolean;
	typing: boolean;
	add: {
		onPress: () => void;
		label: string;
		/** What a screen reader says: "Add expense". */
		description: string;
		/** The folded button's words. */
		folded: string;
		off: boolean;
		busy: boolean;
	};
	/** A hardware key was typed while the keys were folded. */
	onKeypadOpen: () => void;
	/** Tab on a hardware keyboard: the next panel. */
	onTab: () => void;
	/** On a sheet: the sheet's own surface, with no panel of the page's color. */
	surface?: boolean;
}) {
	const { color, space } = useTheme();
	const { fontScale, height } = useWindowDimensions();
	const { bottom } = useSafeAreaInsets();
	const system = fontScale > SYSTEM_PAD_SCALE;
	const open = keypadOpen && !typing && !system;
	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			// The sheet's body ends the home indicator's height above the
			// window's bottom, so the keyboard covers that much less of it.
			keyboardVerticalOffset={typing || system ? bottom : 0}
			style={{
				flex: 1,
				backgroundColor: surface ? undefined : color.bg,
			}}
		>
			<ScrollView
				bounces={false}
				contentContainerStyle={{ flexGrow: 1, gap: space[2] }}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
				style={{ flex: 1 }}
			>
				<View style={{ paddingHorizontal: space[4] }}>{header}</View>
				<View style={{ paddingHorizontal: space[4], gap: space[1] }}>
					{amount}
					{title}
				</View>
				<View style={{ paddingHorizontal: space[4] }}>
					<SummaryLine parts={summary} />
				</View>
				<DetailPager
					dotLabel={changedLabel}
					label={tabsLabel}
					onPageChange={onPageChange}
					page={page}
					tabs={tabs}
				>
					{panels}
				</DetailPager>
				<View
					style={{
						paddingHorizontal: space[4],
						minHeight: space[6],
						justifyContent: "center",
					}}
				>
					{preview}
				</View>
			</ScrollView>
			<View style={{ paddingHorizontal: space[2], paddingBottom: space[2] }}>
				<FoldingKeypad
					addDescription={add.description}
					addLabel={add.label}
					addOff={add.off}
					busy={add.busy}
					compact={height < COMPACT_HEIGHT}
					entry={keypad}
					foldedLabel={add.folded}
					onAdd={add.onPress}
					onOpen={onKeypadOpen}
					onTab={onTab}
					open={open}
				/>
			</View>
		</KeyboardAvoidingView>
	);
}
