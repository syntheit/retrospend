import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { Text } from "@/ui/Text";

/** A labeled single-line text field, at the money input's height. */
export function TextField({
	label,
	value,
	onChangeText,
	invalid,
	maxLength,
	keyboardType,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	invalid?: boolean;
	maxLength?: number;
	keyboardType?: "default" | "decimal-pad";
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<Text tone="fg2" variant="small">
				{label}
			</Text>
			<TextInput
				accessibilityLabel={label}
				autoCorrect={false}
				keyboardType={keyboardType}
				maxLength={maxLength}
				onChangeText={onChangeText}
				style={{
					minHeight: size.touchMin.phone,
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: invalid ? color.danger : color.lineStrong,
					backgroundColor: color.surface,
					color: color.fg,
					fontSize: type.body.size,
				}}
				value={value}
			/>
		</View>
	);
}

export interface Choice {
	id: string;
	label: string;
	/** A second phrase at the end of the row (a figure already worded). */
	detail?: string;
	/** Identity in front of the label: a face, a bare glyph, a dot. */
	lead?: ReactNode;
}

/**
 * A list of choices with a check on the chosen ones. One choice or several
 * is the caller's: it gets the id that was pressed.
 */
export function ChoiceList({
	label,
	choices,
	selected,
	onPress,
}: {
	label?: string;
	choices: Choice[];
	selected: ReadonlySet<string>;
	onPress: (id: string) => void;
}) {
	const { color, size, space } = useTheme();
	return (
		<View>
			{label ? (
				<Text
					accessibilityRole="header"
					style={{ paddingBottom: space[1] }}
					tone="fg2"
					variant="small"
				>
					{label}
				</Text>
			) : null}
			{choices.map((choice) => {
				const on = selected.has(choice.id);
				return (
					<Pressable
						accessibilityLabel={[choice.label, choice.detail]
							.filter(Boolean)
							.join(", ")}
						accessibilityRole="button"
						accessibilityState={{ selected: on }}
						key={choice.id}
						onPress={() => onPress(choice.id)}
						style={({ pressed }) => ({
							minHeight: size.row.phone,
							flexDirection: "row",
							alignItems: "center",
							gap: space[3],
							backgroundColor: pressed ? color.raised : undefined,
							borderBottomWidth: 1,
							borderBottomColor: color.line,
						})}
					>
						{choice.lead}
						<Text numberOfLines={1} style={{ flex: 1 }}>
							{choice.label}
						</Text>
						{choice.detail ? (
							<Text tabular tone="fg2">
								{choice.detail}
							</Text>
						) : null}
						<View style={{ width: size.icon.phone }}>
							{on ? (
								<Glyph
									color={color.brand}
									name="Check"
									size={size.icon.phone}
								/>
							) : null}
						</View>
					</Pressable>
				);
			})}
		</View>
	);
}
