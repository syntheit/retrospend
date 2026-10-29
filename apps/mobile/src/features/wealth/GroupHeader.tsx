import { View } from "react-native";
import { useMoneyText } from "@/features/read/useMoneyText";
import type { Money } from "@/lib/money";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { GroupDot } from "./AllocationBar";

/**
 * A group's heading in the accounts list: its series dot, its name at 16/600
 * and its total, right-aligned, from the server (liabilities are negative; an
 * account with no rate is left out of it). Laid out like the list's
 * SectionHeader so the two read as one family.
 */
export function GroupHeader({
	title,
	series,
	total,
}: {
	title: string;
	series: number | null;
	total: Money | null;
}) {
	const money = useMoneyText();
	const { space } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingTop: space[6],
				paddingBottom: space[2],
			}}
		>
			<View
				style={{
					flex: 1,
					flexDirection: "row",
					alignItems: "center",
					gap: space[2],
				}}
			>
				<GroupDot series={series} />
				<Text accessibilityRole="header" numberOfLines={1} variant="section">
					{title}
				</Text>
			</View>
			{total ? (
				<Text tabular tone="fg2" weight="medium">
					{money(total)}
				</Text>
			) : null}
		</View>
	);
}
