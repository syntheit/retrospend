import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { EmptyDetail } from "@/ui/ListDetail";
import { HAIRLINE } from "@/ui/metrics";
import { Text } from "@/ui/Text";
import { EnvelopeOverview } from "./EnvelopeOverview";
import type { EnvelopeMode } from "./EnvelopeSheet";
import type { MonthKind } from "./months";
import type { BudgetEnvelope, BudgetMonth } from "./source";

export const INSPECTOR_WIDTH = 320;
/** The content width from which the inspector sits beside the table (a table of 560 plus the inspector). */
export const INSPECTOR_MIN_WIDTH = 880;

/**
 * The Budget inspector (expanded tablets): the picked envelope's overview in a
 * column beside the table, so the list stays on screen. Its actions open the
 * same forms as the phone sheet, so a money change keeps its preview and Undo.
 */
export function EnvelopeInspector({
	data,
	envelope,
	kind,
	onMode,
}: {
	data: BudgetMonth;
	envelope: BudgetEnvelope | null;
	kind: MonthKind;
	onMode: (mode: EnvelopeMode) => void;
}) {
	const t = useTranslations("mobile.budget");
	const { color, space } = useTheme();
	return (
		<View
			style={{
				width: INSPECTOR_WIDTH,
				borderLeftWidth: HAIRLINE,
				borderLeftColor: color.line,
			}}
		>
			{envelope ? (
				<ScrollView
					contentContainerStyle={{
						gap: space[3],
						padding: space[4],
						paddingTop: space[6],
					}}
				>
					<Text accessibilityRole="header" numberOfLines={2} variant="section">
						{envelope.name}
					</Text>
					<EnvelopeOverview
						data={data}
						envelope={envelope}
						kind={kind}
						onMode={onMode}
					/>
				</ScrollView>
			) : (
				<EmptyDetail title={t("inspector.empty")} />
			)}
		</View>
	);
}
