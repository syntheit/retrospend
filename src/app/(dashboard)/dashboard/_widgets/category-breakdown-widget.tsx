"use client";

import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CategoryDonut } from "../../_components/category-donut";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function CategoryBreakdownWidget(_props: WidgetProps) {
	const { state, data, isLoading, actions } = useDashboardContext();
	const { formatCurrency } = useCurrencyFormatter();

	return (
		<CategoryDonut
			activeSlice={state.activeSlice}
			activeSliceIndex={state.activeSliceIndex}
			categoryBreakdown={data.categoryBreakdown}
			categoryClickBehavior={data.categoryClickBehavior}
			expensesLoading={isLoading.categories}
			formatMoney={(value: number) =>
				formatCurrency(value, data.homeCurrency)
			}
			handleCategoryClick={actions.handleCategoryClick}
			handleSliceEnter={(_, index) => actions.setActiveSliceIndex(index)}
			handleSliceLeave={() => actions.setActiveSliceIndex(null)}
			hiddenCategories={state.hiddenCategories}
			isUsingMockExpenses={state.isUsingMockExpenses}
			pieChartConfig={data.pieChartConfig}
			visibleCategoryBreakdown={data.visibleCategoryBreakdown}
			visibleTotal={data.visibleTotal}
		/>
	);
}
