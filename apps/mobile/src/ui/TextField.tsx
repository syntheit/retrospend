import { useState } from "react";
import { TextInput, type TextInputProps, View } from "react-native";
import { useTheme } from "@/theme";
import { TEXT_SCALE_CAP, Text, typeStyle } from "./Text";

/** A field's label above it: 13/400 in fg-2, as in iOS Settings. */
export function FieldLabel({ children }: { children: string }) {
	return (
		<Text tone="fg2" variant="small">
			{children}
		</Text>
	);
}

/** What is wrong with a field, under it: 12 in danger, read out at once. */
export function FieldError({ children }: { children: string }) {
	return (
		<Text accessibilityRole="alert" tone="danger" variant="meta">
			{children}
		</Text>
	);
}

/**
 * The one plain text input (GUIDELINE 5): a label over a 44 point field with
 * a surface fill and a line-strong border, brand while focused and danger
 * while invalid. `multiline` makes it a taller box for a message or a note,
 * where the return key starts a new line instead of finishing. Money has its
 * own field (R22); this is for words and plain numbers.
 */
export function TextField({
	label,
	value,
	onChangeText,
	prefix,
	invalid,
	hideLabel,
	multiline,
	keyboardType,
	placeholder,
	maxLength,
	autoCapitalize = "none",
	secure,
	autoComplete,
	textContentType,
	inputMode,
	returnKeyType,
	onSubmitEditing,
	disabled,
	onTypingChange,
	bare,
	align,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	prefix?: string;
	invalid?: boolean;
	/** The placeholder says it; screen readers still get the label. */
	hideLabel?: boolean;
	/** Several lines: a message or a note. */
	multiline?: boolean;
	keyboardType?:
		| "default"
		| "decimal-pad"
		| "number-pad"
		| "url"
		| "email-address";
	placeholder?: string;
	maxLength?: number;
	autoCapitalize?: "none" | "sentences" | "words";
	/** Hides what is typed (passwords). */
	secure?: boolean;
	/** What the system may fill in (a saved password, a one-time code). */
	autoComplete?: TextInputProps["autoComplete"];
	/** The iOS twin of `autoComplete`: what the keychain may fill in. */
	textContentType?: TextInputProps["textContentType"];
	/** Which keyboard shows: email, numeric, url. */
	inputMode?: TextInputProps["inputMode"];
	/** The return key's word; "done" unless said (several lines: a new line). */
	returnKeyType?: "done" | "go" | "next" | "search";
	/** Runs when the return key is pressed (sign in, continue). */
	onSubmitEditing?: () => void;
	/** Not editable (a request is running). */
	disabled?: boolean;
	/** Told when typing starts and stops, so a screen can hide its keypad. */
	onTypingChange?: (typing: boolean) => void;
	/**
	 * No box: no border, fill or side padding, for a field that sits on a card
	 * of its own (the composer's title). The card carries the field's edge.
	 */
	bare?: boolean;
	/** Centers the words, for the composer's title. */
	align?: "center";
}) {
	const theme = useTheme();
	const { color, radius, size, space } = theme;
	const [focused, setFocused] = useState(false);
	function focus(next: boolean) {
		setFocused(next);
		onTypingChange?.(next);
	}
	const boxHeight = multiline ? space[12] * 2 : size.moneyInput.phone;
	return (
		<View style={{ gap: space[1] }}>
			{hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
			<View
				style={{
					minHeight: boxHeight,
					flexDirection: "row",
					alignItems: multiline ? "flex-start" : "center",
					gap: space[2],
					...(bare
						? {}
						: {
								paddingHorizontal: space[3],
								borderRadius: radius.ctl,
								borderWidth: 1,
								borderColor: invalid
									? color.danger
									: focused
										? color.brand
										: color.lineStrong,
								backgroundColor: color.surface,
							}),
				}}
			>
				{prefix ? <Text tone="fg2">{prefix}</Text> : null}
				<TextInput
					accessibilityLabel={label}
					autoCapitalize={autoCapitalize}
					autoComplete={autoComplete}
					autoCorrect={autoCapitalize === "sentences"}
					editable={!disabled}
					importantForAutofill={autoComplete ? "yes" : "auto"}
					inputMode={inputMode}
					keyboardType={keyboardType}
					maxFontSizeMultiplier={TEXT_SCALE_CAP.body}
					maxLength={maxLength}
					multiline={multiline}
					onBlur={() => focus(false)}
					onChangeText={onChangeText}
					onFocus={() => focus(true)}
					onSubmitEditing={onSubmitEditing}
					placeholder={placeholder}
					placeholderTextColor={color.fg3}
					returnKeyType={multiline ? "default" : (returnKeyType ?? "done")}
					secureTextEntry={secure}
					selectionColor={color.brand}
					style={[
						typeStyle(theme, "body"),
						{
							flex: 1,
							minHeight: multiline
								? boxHeight - 2 * space[2]
								: size.touchMin.phone,
							color: color.fg,
							textAlign: align,
						},
						multiline
							? { paddingVertical: space[2], textAlignVertical: "top" }
							: null,
					]}
					textContentType={textContentType}
					value={value}
				/>
			</View>
		</View>
	);
}
