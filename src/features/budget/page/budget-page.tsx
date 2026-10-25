import "server-only";

import { BudgetScreen } from "./budget-screen";

/**
 * The Budget. The month depends
 * on the viewer's day and zone, which the server reads for the current
 * month, so the screen asks for it and shows a skeleton at real height
 * until it arrives (R14).
 */
export function BudgetPage() {
	return <BudgetScreen />;
}
