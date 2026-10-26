import { Suspense } from "react";
import { BudgetPage } from "~/features/budget/page/budget-page";
import { BudgetSkeleton } from "~/features/budget/page/states";

export default function Page() {
	return (
		<Suspense fallback={<BudgetSkeleton />}>
			<BudgetPage />
		</Suspense>
	);
}
