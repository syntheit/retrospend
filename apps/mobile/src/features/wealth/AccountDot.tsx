import { View } from "react-native";
import { useTheme } from "@/theme";
import { groupOf } from "./accounts";
import type { Account } from "./source";

/**
 * The dot of an account's group: the same series color the Wealth page uses
 * for the group, so the account is known by where it sits. Liabilities stay
 * neutral. A type the groups do not know reads as cash.
 */
export function AccountDot({ type }: { type: string }) {
	const { color, radius, space } = useTheme();
	const group = groupOf(type as Account["type"]) ?? "cash";
	const fill =
		group === "cash"
			? color.series1
			: group === "investments"
				? color.series2
				: group === "crypto"
					? color.series3
					: group === "property"
						? color.series4
						: color.fg3;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: space[2],
				height: space[2],
				borderRadius: radius.chip,
				backgroundColor: fill,
			}}
		/>
	);
}
