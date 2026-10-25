import { Suspense } from "react";
import { BudgetPage } from "~/features/budget/page/budget-page";
import { newBudgetEnabled } from "~/features/budget/page/enabled";
import { BudgetSkeleton } from "~/features/budget/page/states";
import LegacyBudgetPage from "./legacy-page";

/**
 * uiV2 with the envelope budget picks the redesigned page per viewer; either
 * off renders today's page unchanged.
 */
export default async function Page() {
	if (!(await newBudgetEnabled())) return <LegacyBudgetPage />;
	return (
		<Suspense fallback={<BudgetSkeleton />}>
			<BudgetPage />
		</Suspense>
	);
}
