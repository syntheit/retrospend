import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { monthDate } from "./months";
import { Line, Note, SheetBody } from "./parts";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * Money in this month: what came in, and what the plan costs against what you
 * usually get. Every figure is the server's; this sheet only words them.
 */
export function IncomeSheet({
	data,
	visible,
	onClose,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.income");
	const money = useMoneyText();
	const format = useFormatter();
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
	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title", { month })}
			visible={visible}
		>
			<SheetBody>
				<Line label={t("moneyIn")} value={money(data.toAssign.terms.moneyIn)} />
				{read.status === "error" ? (
					<Note tone="attention">{t("error")}</Note>
				) : null}
				{plan ? (
					<>
						<Note>
							{plan.typicalIncome
								? t("planCost", {
										cost: money(plan.cost),
										income: money(plan.typicalIncome),
									})
								: t("planCostOnly", { cost: money(plan.cost) })}
						</Note>
						{plan.runway ? (
							<Note>
								{t("runway", {
									months: format.number(plan.runway.tenths / 10, {
										maximumFractionDigits: 1,
									}),
									available: money(plan.runway.available),
								})}
							</Note>
						) : null}
						{plan.incomplete ? <Note>{t("incomplete")}</Note> : null}
					</>
				) : null}
			</SheetBody>
		</Sheet>
	);
}
