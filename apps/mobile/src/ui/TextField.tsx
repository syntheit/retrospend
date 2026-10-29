import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTheme } from "@/theme";

/** A field's label above it: 13/500 in fg-2. */
export function FieldLabel({ children }: { children: string }) {
	const { color, font, type } = useTheme();
	return (
		<Text
			style={{
				color: color.fg2,
				fontSize: type.small.size,
				fontWeight: String(font.weight.medium) as "500",
			}}
		>
			{children}
		</Text>
	);
}

/** What is wrong with a field, under it: 12 in danger, read out at once. */
export function FieldError({ children }: { children: string }) {
	const { color, type } = useTheme();
	return (
		<Text
			accessibilityRole="alert"
			style={{ color: color.danger, fontSize: type.meta.size }}
		>
			{children}
		</Text>
	);
}

/**
 * The one plain text input (GUIDELINE 5): a label over a 44 point field with
 * a surface fill and a line-strong border, brand while focused and danger
 * while invalid. Money has its own field (R22); this is for words and plain
 * numbers.
 */
export function TextField({
	label,
	value,
	onChangeText,
	prefix,
	invalid,
	hideLabel,
	keyboardType,
	placeholder,
	maxLength,
	autoCapitalize = "none",
	secure,
	autoComplete,
	onTypingChange,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	prefix?: string;
	invalid?: boolean;
	/** The placeholder says it; screen readers still get the label. */
	hideLabel?: boolean;
	keyboardType?: "default" | "decimal-pad" | "number-pad" | "url";
	placeholder?: string;
	maxLength?: number;
	autoCapitalize?: "none" | "sentences" | "words";
	/** Hides what is typed (passwords). */
	secure?: boolean;
	/** What the system may fill in (a saved password, a one-time code). */
	autoComplete?: "current-password" | "new-password" | "one-time-code";
	/** Told when typing starts and stops, so a screen can hide its keypad. */
	onTypingChange?: (typing: boolean) => void;
}) {
	const { color, radius, size, space, type } = useTheme();
	const [focused, setFocused] = useState(false);
	function focus(next: boolean) {
		setFocused(next);
		onTypingChange?.(next);
	}
	return (
		<View style={{ gap: space[1] }}>
			{hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
			<View
				style={{
					minHeight: size.moneyInput.phone,
					flexDirection: "row",
					alignItems: "center",
					gap: space[2],
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: invalid
						? color.danger
						: focused
							? color.brand
							: color.lineStrong,
					backgroundColor: color.surface,
				}}
			>
				{prefix ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{prefix}
					</Text>
				) : null}
				<TextInput
					accessibilityLabel={label}
					autoCapitalize={autoCapitalize}
					autoComplete={autoComplete}
					autoCorrect={autoCapitalize === "sentences"}
					keyboardType={keyboardType}
					maxLength={maxLength}
					onBlur={() => focus(false)}
					onChangeText={onChangeText}
					onFocus={() => focus(true)}
					placeholder={placeholder}
					placeholderTextColor={color.fg3}
					returnKeyType="done"
					secureTextEntry={secure}
					selectionColor={color.brand}
					style={{
						flex: 1,
						minHeight: size.touchMin.phone,
						color: color.fg,
						fontSize: type.body.size,
					}}
					value={value}
				/>
			</View>
		</View>
	);
}
