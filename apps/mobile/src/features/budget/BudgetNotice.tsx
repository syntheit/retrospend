import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { overEnvelopes } from "./rows";
import type { BudgetMonth } from "./source";

/**
 * At most one notice under the hero, and only when its button differs from
 * the hero's own (a fact appears once). Money nobody planned yet is info
 * (a blue fill); overspent envelopes need the person (an amber fill). The
 * sentence says which, so the fill never carries it alone. The words and the
 * numbers are the verdict's; the one secondary button opens the sheet that
 * fixes it.
 */
export function BudgetNotice({
	data,
	canAct,
	onUsePlan,
	onCover,
}: {
	data: BudgetMonth;
	canAct: boolean;
	onUsePlan: () => void;
	onCover: () => void;
}) {
	const t = useTranslations("mobile.budget.notice");
	const money = useMoneyText();
	const { color, radius, size, space } = useTheme();
	const notice = data.verdict.notice;
	if (!notice || notice.action === data.verdict.action) return null;
	const over = overEnvelopes(data);
	const attention = notice.kind === "OVERSPENT";
	const text = attention
		? t("overspent", {
				count: over.length,
				name: over.length === 1 ? (over[0]?.name ?? "") : "",
				amount: money(notice.amount, { sign: "never" }),
			})
		: t("notPlanned", { amount: money(notice.amount) });
	const action =
		canAct && notice.action === "USE_PLAN"
			? { label: t("usePlan"), run: onUsePlan }
			: canAct && notice.action === "COVER"
				? { label: t("cover"), run: onCover }
				: null;
	return (
		<View
			accessibilityRole={attention ? "alert" : undefined}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				marginHorizontal: size.gutter.phone,
				marginTop: space[4],
				padding: space[3],
				borderRadius: radius.ctl,
				backgroundColor: attention ? color.attentionBg : color.infoBg,
			}}
		>
			<Text style={{ flex: 1 }}>{text}</Text>
			{action ? (
				<Button
					label={action.label}
					onPress={action.run}
					size="small"
					variant="outlined"
				/>
			) : null}
		</View>
	);
}
