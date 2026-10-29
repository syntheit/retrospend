import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph, type GlyphName } from "@/ui/Glyph";
import { Text } from "@/ui/Text";

export interface PersonAction {
	id: string;
	label: string;
	/** Leads the label, as the mockup's tiles do (Banknote, Bell, Plus). */
	glyph?: GlyphName;
	onPress: () => void;
	/** The one filled action (Settle up). */
	primary?: boolean;
}

/**
 * The actions on a person, as equal tiles in one row: Settle up (the brand
 * fill), Remind and Expense. Each is as wide as the others and at least the
 * touch size tall.
 */
export function PersonActions({ actions }: { actions: PersonAction[] }) {
	const { color, radius, size, space } = useTheme();
	if (actions.length === 0) return null;
	return (
		<View
			style={{
				flexDirection: "row",
				gap: space[3],
				paddingHorizontal: size.gutter.phone,
			}}
		>
			{actions.map((action) => (
				<Pressable
					accessibilityLabel={action.label}
					accessibilityRole="button"
					key={action.id}
					onPress={action.onPress}
					style={({ pressed }) => ({
						flex: 1,
						minHeight: space[12],
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "center",
						gap: space[2],
						paddingHorizontal: space[2],
						borderRadius: radius.ctl,
						borderWidth: 1,
						borderColor: action.primary ? color.brand : color.lineStrong,
						backgroundColor: action.primary
							? color.brand
							: pressed
								? color.raised
								: color.surface,
					})}
				>
					{action.glyph ? (
						<Glyph
							color={action.primary ? color.brandFg : color.fg}
							name={action.glyph}
							size={size.icon.phone}
						/>
					) : null}
					<Text
						numberOfLines={1}
						style={action.primary ? { color: color.brandFg } : undefined}
						variant="body"
						weight="medium"
					>
						{action.label}
					</Text>
				</Pressable>
			))}
		</View>
	);
}
