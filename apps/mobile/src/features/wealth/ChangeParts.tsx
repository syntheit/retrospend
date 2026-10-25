import { View } from "react-native";
import { useTranslations } from "use-intl";
import { Line } from "@/features/budget/parts";
import { SectionHeader } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import type { NetWorth } from "./source";

const ORDER = [
	"income",
	"spending",
	"exchange",
	"notLogged",
	"revaluation",
	"opened",
	"closed",
] as const;

/**
 * Why net worth moved: the server's parts, which add up to the total to the
 * minor unit. Parts that are zero stay out; each is signed.
 */
export function ChangeParts({
	change,
}: {
	change: NonNullable<NetWorth["change"]>;
}) {
	const t = useTranslations("mobile.wealth");
	const money = useMoneyText();
	const { space } = useTheme();
	const rows = ORDER.filter((part) => change.parts[part].minor !== 0);
	if (rows.length === 0) return null;
	return (
		<View>
			<SectionHeader title={t("whyTitle", { days: change.days })} />
			<View style={{ paddingHorizontal: space[4] }}>
				{rows.map((part) => (
					<Line
						key={part}
						label={t(`parts.${part}`)}
						value={money(change.parts[part], { sign: "exceptZero" })}
					/>
				))}
			</View>
		</View>
	);
}
