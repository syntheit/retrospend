/**
 * Figure ids each page must render (SYNTHESIS-r5 §6 "Required keys"), keyed
 * by the page label the flows use. A page fails the audit when one is
 * missing, so deleting a tag cannot hide a mismatch. Today's pages carry no
 * figures yet; S4 adds each page's ids here as it tags them.
 */
export const REQUIRED_FIGURES: Readonly<Record<string, readonly string[]>> = {
	dashboard: [],
	transactions: [],
	people: ["owed.owedToYou", "owed.youOwe"],
	projects: [],
	wealth: [],
	budget: [],
	settings: [],
};

export function requiredFiguresFor(page: string): readonly string[] {
	return REQUIRED_FIGURES[page] ?? [];
}
