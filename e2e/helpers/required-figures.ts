/**
 * Figure ids each page must render (SYNTHESIS-r5 §6 "Required keys"), keyed
 * by the page label the flows use. A page fails the audit when one is
 * missing, so deleting a tag cannot hide a mismatch. Today's pages carry no
 * figures yet; S4 adds each page's ids here as it tags them.
 */
export const REQUIRED_FIGURES: Readonly<Record<string, readonly string[]>> = {
	dashboard: [],
	transactions: [],
	people: [],
	projects: [],
	wealth: [],
	budget: [],
	settings: [],
	// S4B, as the flows open them: Martín's rows with Sofía, every month, and
	// his month view, whose footer is spent() for the month.
	activity: ["entry.amount:shared:e2e_tx_dp_calefon"],
	activityMonth: ["spent"],
	recurring: ["recurring.cost.out.month"],
};

export function requiredFiguresFor(page: string): readonly string[] {
	return REQUIRED_FIGURES[page] ?? [];
}
