import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { FieldError } from "@/ui/TextField";
import { AmountCard, type MoneyLine } from "./AmountCard";
import { ComposerBar } from "./ComposerBar";

export type EntryMode = "expense" | "income" | "transfer";

/**
 * The composer's frame, the same on the iPhone tab, the iPad form sheet and
 * the Android bottom sheet: the head, the fields that scroll, and under them
 * what stays in the thumb zone. In the quick step that is the amount card,
 * the one-line preview, the operators with Add, and the keypad; in More it is
 * only Back and Add. While a text field is being typed in, the keypad steps
 * aside for the system keyboard.
 */
export function ComposerShell({
	step,
	header,
	lines,
	keypad,
	typing,
	padOpen,
	onScrollDrag,
	amountError,
	rate,
	preview,
	onOperator,
	onBack,
	onAdd,
	addLabel,
	addDescription,
	addOff,
	busy,
	surface,
	children,
}: {
	step: "quick" | "more";
	header: ReactNode;
	lines: MoneyLine[];
	/** What the keypad types into: the active amount. */
	keypad: {
		text: string;
		currency: string;
		onChange: (text: string) => void;
	};
	typing: boolean;
	padOpen: boolean;
	/** Scrolling the fields folds the keypad away. */
	onScrollDrag: () => void;
	amountError: boolean;
	/** Under the amount, inside its card: the rate and the value at home, for another currency. */
	rate?: ReactNode;
	/** The one-line "what this changes" above the bar. */
	preview: ReactNode;
	onOperator: (sign: string) => void;
	onBack: () => void;
	onAdd: () => void;
	addLabel: string;
	/** What a screen reader says for the Add button: "Add expense". */
	addDescription: string;
	/** Nothing to add yet, or the dry run of what Add would send is not in. */
	addOff: boolean;
	busy: boolean;
	/** On a sheet: the sheet's own surface, with no panel of the page's color. */
	surface?: boolean;
	children: ReactNode;
}) {
	const t = useTranslations("mobile.composer");
	const { color, space } = useTheme();
	const quick = step === "quick";
	const keypadUp = quick && !typing && padOpen;
	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			style={{
				flex: 1,
				backgroundColor: surface ? undefined : color.bg,
			}}
		>
			<View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
				{header}
			</View>
			<ScrollView
				// More brings its own gutter: its inset groups sit in the page's.
				contentContainerStyle={{
					paddingVertical: space[4],
					paddingHorizontal: quick ? space[4] : 0,
					gap: space[4],
				}}
				keyboardShouldPersistTaps="handled"
				onScrollBeginDrag={onScrollDrag}
				style={{ flex: 1 }}
			>
				{children}
			</ScrollView>
			<View
				style={{
					gap: space[2],
					paddingHorizontal: space[4],
					paddingTop: space[2],
					paddingBottom: space[2],
					borderTopWidth: 1,
					borderTopColor: color.line,
				}}
			>
				{quick ? (
					<>
						<AmountCard
							foreign={rate}
							lines={lines}
							ring={amountError ? "error" : keypadUp ? "focus" : "idle"}
						/>
						{amountError ? (
							<View style={{ alignItems: "flex-end" }}>
								<FieldError>{t("errors.amount")}</FieldError>
							</View>
						) : null}
						{preview}
					</>
				) : null}
				<ComposerBar
					addDescription={addDescription}
					addLabel={addLabel}
					addOff={addOff}
					busy={busy}
					onAdd={onAdd}
					onBack={onBack}
					onOperator={onOperator}
					showOperators={!typing}
					step={step}
				/>
				{keypadUp ? (
					<MoneyKeypad
						currency={keypad.currency}
						draft={keypad.text}
						onDraftChange={keypad.onChange}
					/>
				) : null}
			</View>
		</KeyboardAvoidingView>
	);
}
