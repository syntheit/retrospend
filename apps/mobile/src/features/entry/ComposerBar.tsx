import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { TextAction } from "@/features/activity/TextAction";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/** The operators the amount takes; the domain reads the typed sum exactly. */
const OPERATORS = [
	{ key: "plus", sign: "+" },
	{ key: "minus", sign: "−" },
	{ key: "times", sign: "×" },
	{ key: "divide", sign: "÷" },
] as const;

/**
 * The bar over the keypad: the four operators on the left for adding up an
 * amount, or Back on More, and the primary Add button at the end (off until
 * there is an amount to add).
 */
export function ComposerBar({
	step,
	showOperators,
	onOperator,
	onBack,
	onAdd,
	addLabel,
	addDescription,
	addOff,
	busy,
}: {
	step: "quick" | "more";
	/** The operators work on the amount; hidden while a text field is typed in. */
	showOperators: boolean;
	onOperator: (sign: string) => void;
	onBack: () => void;
	onAdd: () => void;
	addLabel: string;
	/** What a screen reader says for the Add button: "Add expense". */
	addDescription: string;
	/** Nothing to add yet, or the dry run is not in. */
	addOff: boolean;
	busy: boolean;
}) {
	const t = useTranslations("mobile.composer");
	const { color, radius, size, space } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[2],
			}}
		>
			{step === "more" ? (
				<TextAction label={t("back")} onPress={onBack} />
			) : showOperators ? (
				<View
					accessibilityLabel={t("ops.label")}
					style={{ flexDirection: "row", gap: space[2] }}
				>
					{OPERATORS.map((op) => (
						<Pressable
							accessibilityLabel={t(`ops.${op.key}`)}
							accessibilityRole="button"
							key={op.key}
							onPress={() => onOperator(op.sign)}
							style={({ pressed }) => ({
								minWidth: size.touchMin.phone,
								minHeight: size.touchMin.phone,
								alignItems: "center",
								justifyContent: "center",
								borderRadius: radius.chip,
								backgroundColor: pressed ? color.line : color.raised,
							})}
						>
							<Text variant="title" weight="medium">
								{op.sign}
							</Text>
						</Pressable>
					))}
				</View>
			) : (
				<View />
			)}
			<Button
				accessibilityLabel={addDescription}
				disabled={addOff || busy}
				label={addLabel}
				onPress={onAdd}
			/>
		</View>
	);
}
