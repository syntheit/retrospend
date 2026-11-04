import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { BalanceBar } from "./BalanceBar";
import { NetAmount } from "./NetAmount";
import type { PeopleOverview } from "./source";

/**
 * Where you stand: Owed to you and You owe as two figures at 28, never
 * netted, then the bar of the people who make them up and how many there
 * are. A currency without a rate is named as not in the totals.
 */
export function PeopleTop({
	overview,
	onPerson,
}: {
	overview: PeopleOverview;
	onPerson: (key: string) => void;
}) {
	const t = useTranslations("mobile.people");
	const { space } = useTheme();
	const owed = overview.people.filter((p) => p.group === "owed");
	const owe = overview.people.filter((p) => p.group === "owe");
	// With no one at all the empty state speaks; "Settled" needs someone settled.
	if (overview.people.length === 0) return null;
	if (owed.length === 0 && owe.length === 0) {
		return (
			<View style={{ padding: space[4] }}>
				<Text accessibilityRole="header" variant="title">
					{t("allSettled")}
				</Text>
			</View>
		);
	}
	const parts = overview.people.flatMap((p) => p.parts);
	// Each total is an estimate only from the parts on its own side.
	const owedParts = parts.filter((p) => p.amount.minor > 0);
	const oweParts = parts.filter((p) => p.amount.minor < 0);
	return (
		<View style={{ gap: space[3], padding: space[4] }}>
			<View style={{ gap: space[1] }}>
				<Text tone="fg2" variant="small">
					{t("owedToYou")}
				</Text>
				<NetAmount
					align="left"
					home={overview.home}
					net={overview.owedToYou}
					parts={owedParts}
					showCount={false}
					size="hero"
					tone="positive"
				/>
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Text tone="fg2" variant="small">
					{t("youOwe")}
				</Text>
				<NetAmount
					home={overview.home}
					net={overview.youOwe}
					parts={oweParts}
					showCount={false}
					size="hero"
					tone="default"
				/>
			</View>
			<BalanceBar onPerson={onPerson} overview={overview} />
			<View
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<Text tone="fg3" variant="meta">
					{t("peopleOweYou", { count: owed.length })}
				</Text>
				{owe.length > 0 ? (
					<Text style={{ textAlign: "right" }} tone="fg3" variant="meta">
						{t("youOwePeople", { count: owe.length })}
					</Text>
				) : null}
			</View>
			{overview.unpriced.length > 0 ? (
				<Text tone="fg3" variant="meta">
					{t("unpriced", { currencies: overview.unpriced.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
