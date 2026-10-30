import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Hero } from "@/ui/Hero";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import type { OpenSheet } from "./BudgetSheets";
import { monthDate } from "./months";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * Money in this month: what came in as the one number, then what the plan
 * costs against what you usually get, and the way to the income rules. Every
 * figure is the server's; this sheet only words them.
 */
export function IncomeSheet({
	data,
	visible,
	detent = "large",
	onClose,
	onOpen,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onOpen?: (sheet: OpenSheet) => void;
}) {
	const t = useTranslations("mobile.budget.income");
	const tr = useTranslations("mobile.budget.manage");
	const money = useMoneyText();
	const format = useFormatter();
	const { space } = useTheme();
	const key = data.month.key;
	const read = useSheetRead(
		visible,
		(client) => client.budget.planCost({ month: key }),
		String(key),
	);
	const plan = read.status === "ready" ? read.data : null;
	const month = format.dateTime(monthDate(key), {
		month: "long",
		timeZone: "UTC",
	});
	const cost = plan
		? plan.typicalIncome
			? t("planCost", {
					cost: money(plan.cost),
					income: money(plan.typicalIncome),
				})
			: t("planCostOnly", { cost: money(plan.cost) })
		: undefined;
	return (
		<Sheet
			detents={[detent]}
			onClose={onClose}
			title={t("title", { month })}
			visible={visible}
		>
			<SheetBody>
				<Hero
					label={t("moneyIn")}
					sub={cost}
					tone="positive"
					value={money(data.toAssign.terms.moneyIn)}
				/>
				{read.status === "error" ? (
					<Note tone="attention">{t("error")}</Note>
				) : null}
				{plan?.runway ? (
					<Note>
						{t("runway", {
							months: format.number(plan.runway.tenths / 10, {
								maximumFractionDigits: 1,
							}),
							available: money(plan.runway.available),
						})}
					</Note>
				) : null}
				{plan?.incomplete ? <Note>{t("incomplete")}</Note> : null}
				{onOpen ? (
					<View style={{ flexDirection: "row", gap: space[2] }}>
						<Chip
							label={tr("rules")}
							onPress={() => onOpen({ kind: "rules" })}
						/>
					</View>
				) : null}
			</SheetBody>
		</Sheet>
	);
}
