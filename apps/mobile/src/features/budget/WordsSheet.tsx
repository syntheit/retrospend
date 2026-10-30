import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";

const WORDS = ["left", "notPlanned", "toAssign", "held"] as const;

/**
 * What the words on the Budget page mean, one line each. Opened by the help
 * button beside the hero's label. It only explains: nothing here changes
 * money.
 */
export function WordsSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.help");
	const { space } = useTheme();
	return (
		<Sheet
			detents={["medium"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<View style={{ gap: space[4] }}>
				{WORDS.map((word) => (
					<View key={word} style={{ gap: space[1] }}>
						<Text weight="semibold">{t(`${word}Title`)}</Text>
						<Text tone="fg2">{t(word)}</Text>
					</View>
				))}
			</View>
		</Sheet>
	);
}
