import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { HAIRLINE } from "@/ui/metrics";
import { Text } from "@/ui/Text";

export { TextField } from "@/ui/TextField";

export interface Choice {
	id: string;
	label: string;
	/** A second phrase at the end of the row (a figure already worded). */
	detail?: string;
	/** Attention when the figure needs the person (a negative left). */
	detailTone?: "attention";
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
							borderBottomWidth: HAIRLINE,
							borderBottomColor: color.line,
						})}
					>
						{choice.lead}
						<Text numberOfLines={1} style={{ flex: 1 }}>
							{choice.label}
						</Text>
						{choice.detail ? (
							<Text tabular tone={choice.detailTone ?? "fg2"}>
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
