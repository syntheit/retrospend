import { Pressable, View } from "react-native";
import {
	FormSheet,
	WriteForm as Form,
	type WriteAnswer,
	type WriteFormProps,
} from "@/features/write/WriteForm";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import type { SheetDetent } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { BudgetChanges } from "./BudgetChanges";
import type { BudgetMonth, BudgetPreview } from "./source";

export { FormSheet, type WriteAnswer };

/** A budget write: the generic write form with the budget's dry run (`data` names the envelopes). */
export type WriteProps<I, W extends WriteAnswer> = Omit<
	WriteFormProps<I, BudgetPreview, W>,
	"changes" | "error"
> & { data: BudgetMonth | null };

/** The body of one budget write: the fields, the budget's changes, one Save. */
export function WriteForm<I, W extends WriteAnswer>({
	data,
	...form
}: WriteProps<I, W>) {
	return (
		<Form
			{...form}
			changes={({ preview, status }) => (
				<BudgetChanges data={data} preview={preview} status={status} />
			)}
		/>
	);
}

/** A sheet of its own around one budget write form. */
export function WriteSheet<I, W extends WriteAnswer>({
	visible,
	title,
	detent = "large",
	...form
}: WriteProps<I, W> & {
	visible: boolean;
	title: string;
	detent?: SheetDetent;
}) {
	return (
		<FormSheet
			detent={detent}
			onClose={form.onClose}
			title={title}
			visible={visible}
		>
			<WriteForm {...form} active={visible} />
		</FormSheet>
	);
}

/**
 * The way back from a form that opened inside a sheet: a chevron and the
 * word in the brand color, the way a navigation bar draws Back, on its own
 * line at the start.
 */
export function BackButton({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View style={{ alignItems: "flex-start" }}>
			<Pressable
				accessibilityLabel={label}
				accessibilityRole="button"
				onPress={onPress}
				style={({ pressed }) => ({
					minHeight: size.touchMin.phone,
					flexDirection: "row",
					alignItems: "center",
					paddingRight: space[2],
					borderRadius: radius.ctl,
					backgroundColor: pressed ? color.raised : "transparent",
				})}
			>
				<View style={{ transform: [{ rotate: "180deg" }] }}>
					<Glyph
						color={color.brand}
						name="ChevronRight"
						size={size.icon.phone}
					/>
				</View>
				<Text style={{ color: color.brand }} weight="medium">
					{label}
				</Text>
			</Pressable>
		</View>
	);
}
