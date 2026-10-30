import { View } from "react-native";
import { useTranslations } from "use-intl";

import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { OperatorKeys } from "@/ui/OperatorKeys";

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
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
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
				<Chip
					accessibilityLabel={tc("back")}
					label={tc("back")}
					onPress={onBack}
				/>
			) : showOperators ? (
				<OperatorKeys onOperator={onOperator} />
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
