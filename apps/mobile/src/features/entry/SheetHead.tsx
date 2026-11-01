import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";

/**
 * The head of a composer sheet with no mode switch (Add recurring, Settle
 * up): Cancel at the start, then the title.
 */
export function SheetHead({
	title,
	onCancel,
}: {
	title: string;
	onCancel: () => void;
}) {
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
			}}
		>
			<TextAction label={tc("cancel")} onPress={onCancel} />
			<Text
				accessibilityRole="header"
				numberOfLines={1}
				style={{ flex: 1 }}
				variant="section"
			>
				{title}
			</Text>
		</View>
	);
}
