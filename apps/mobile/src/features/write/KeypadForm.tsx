import type { ReactNode } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	COMPACT_HEIGHT,
	SYSTEM_PAD_SCALE,
} from "@/features/entry/ComposerFrame";
import { useSystemPad } from "@/layout/useHardwareKeyboard";
import { useTheme } from "@/theme";
import { FoldingKeypad, type KeypadEntry } from "@/ui/FoldingKeypad";

/**
 * A money sheet on the composer's footing, without its tabs: the head and the
 * amount stay put at the top, the rest scrolls in the middle, and at the foot
 * the keypad folds into one full-width button. It is the composer frame
 * (`ComposerFrame`) for a sheet with a single thing to say. Typing in a text
 * field, or the largest text sizes, swap the keypad for the system keyboard.
 */
export function KeypadForm({
	head,
	amount,
	children,
	keypad,
	keypadOpen,
	typing,
	add,
	onScrollDrag,
}: {
	head?: ReactNode;
	/** The amount block. */
	amount: ReactNode;
	/** The rest of the form: it scrolls. */
	children: ReactNode;
	keypad: KeypadEntry;
	keypadOpen: boolean;
	typing: boolean;
	add: {
		onPress: () => void;
		label: string;
		description: string;
		folded: string;
		off: boolean;
		busy: boolean;
	};
	onScrollDrag?: () => void;
}) {
	const { space } = useTheme();
	const { fontScale, height } = useWindowDimensions();
	const { bottom } = useSafeAreaInsets();
	const system = useSystemPad(fontScale, SYSTEM_PAD_SCALE);
	const open = keypadOpen && !typing && !system;
	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			keyboardVerticalOffset={typing || system ? bottom : 0}
			style={{ flex: 1 }}
		>
			<View style={{ paddingHorizontal: space[4], gap: space[2] }}>
				{head}
				{amount}
			</View>
			<ScrollView
				bounces={false}
				contentContainerStyle={{
					flexGrow: 1,
					gap: space[4],
					paddingHorizontal: space[4],
					paddingTop: space[3],
					paddingBottom: space[2],
				}}
				keyboardShouldPersistTaps="handled"
				onScrollBeginDrag={onScrollDrag}
				showsVerticalScrollIndicator={false}
				style={{ flex: 1 }}
			>
				{children}
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
					open={open}
				/>
			</View>
		</KeyboardAvoidingView>
	);
}
