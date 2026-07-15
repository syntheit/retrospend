"use client";

import { BudgetPacingChart } from "../../_components/budget-pacing-chart";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function BudgetPacingWidget(_props: WidgetProps) {
	const { data, isLoading } = useDashboardContext();

	return (
		<div className="h-[300px] sm:h-[380px]">
			<BudgetPacingChart
				chartConfig={data.areaChartConfig}
				currentDay={data.budgetPacing.currentDay}
				dailyTrend={data.dailyTrend}
				daysInMonth={data.budgetPacing.daysInMonth}
				expensesLoading={isLoading.trend}
				homeCurrency={data.homeCurrency}
				variableBudget={data.budgetPacing.variableBudget}
				variableSpent={data.budgetPacing.variableSpent}
			/>
		</div>
	);
}
