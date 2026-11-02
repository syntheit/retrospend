import {
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, {
	ReduceMotion,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSystemPad } from "@/layout/useHardwareKeyboard";
import { useTheme } from "@/theme";
import { DetailPager, type PagerTab } from "@/ui/DetailPager";
import { FoldingKeypad, type KeypadEntry } from "@/ui/FoldingKeypad";
import { easeLand } from "@/ui/motion";
import { SummaryLine, type SummaryPart } from "@/ui/SummaryLine";
import type { EntryMode } from "./types";

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
export interface ComposerFrameProps {
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
	/** Scrolling the details lets the system keyboard (and the keypad) go. */
	onScrollDrag: () => void;
	/** On a sheet: the sheet's own surface, with no panel of the page's color. */
	surface?: boolean;
	/** The mode on screen (Add entry only): a change fades the details in, and the pager lands on its page at once. */
	mode?: EntryMode;
}

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
	onScrollDrag,
	surface,
	mode,
}: ComposerFrameProps) {
	const theme = useTheme();
	const { color, duration, space } = theme;
	const { fontScale, height } = useWindowDimensions();
	const { bottom } = useSafeAreaInsets();
	// The details scroll as a whole on a short window: the panels get what is left.
	const [viewport, setViewport] = useState<number | undefined>(undefined);
	const system = useSystemPad(fontScale, SYSTEM_PAD_SCALE);
	const open = keypadOpen && !typing && !system;

	// Switching Expense, Income and Transfer keeps the head, the segmented
	// control, the amount and the keypad exactly where they are; only the
	// details under them change, and they fade in (menu duration).
	const fade = useSharedValue(1);
	const shownMode = useRef(mode);
	const ease = useMemo(() => easeLand(theme), [theme]);
	useLayoutEffect(() => {
		if (shownMode.current === mode) return;
		shownMode.current = mode;
		fade.value = 0;
		fade.value = withTiming(1, {
			duration: duration.menu,
			easing: ease,
			// Opacity is what reduced motion keeps.
			reduceMotion: ReduceMotion.Never,
		});
	}, [mode, duration.menu, ease, fade]);
	const details = useAnimatedStyle(() => ({ opacity: fade.value }));
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
			{/* The head and the amount stay put: what is typed is always on screen.
			    With the system keyboard up (large text) the sheet is short, so the
			    head scrolls with the details and the amount sits above the Add button. */}
			{system ? null : (
				<View
					style={{
						paddingHorizontal: space[4],
						paddingBottom: space[1],
						gap: space[1],
					}}
				>
					{header}
					{amount}
				</View>
			)}
			<Animated.View style={[{ flex: 1 }, details]}>
				<ScrollView
					bounces={false}
					contentContainerStyle={{ flexGrow: 1, gap: space[3] }}
					keyboardShouldPersistTaps="handled"
					onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
					onScrollBeginDrag={onScrollDrag}
					showsVerticalScrollIndicator={false}
					style={{ flex: 1 }}
				>
					{system ? (
						<View style={{ paddingHorizontal: space[4] }}>{header}</View>
					) : null}
					<View style={{ paddingHorizontal: space[4], gap: space[1] }}>
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
						snapKey={mode}
						tabs={tabs}
						viewportHeight={viewport}
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
			</Animated.View>
			{system ? (
				<View style={{ paddingHorizontal: space[4], paddingBottom: space[1] }}>
					{amount}
				</View>
			) : null}
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
					open={open}
				/>
			</View>
		</KeyboardAvoidingView>
	);
}
