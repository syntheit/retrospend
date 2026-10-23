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
	// The redesigned project pages (uiV2) on the seed: Sofía's balance in
	// each project on the list; the group total and her share on Depto
	// Palermo; her balance with Martín on its Summary. Their own keys, so
	// the smoke walk of today's pages (no figures) never requires them.
	"projects-v2": [
		"project.member.balance:e2e_project_depto:user:e2e_user_sofia",
		"project.member.balance:e2e_project_floripa:user:e2e_user_sofia",
	],
	"project-v2": [
		"project.total:e2e_project_depto",
		"project.member.share:e2e_project_depto:user:e2e_user_sofia",
	],
	"project-v2-summary": [
		"project.total:e2e_project_depto",
		"balance.person:e2e_project_depto:user:e2e_user_martin",
	],
	// S4B, as the flows open them: Martín's rows with Sofía, every month, and
	// his month view, whose footer is spent() for the month.
	activity: ["entry.amount:shared:e2e_tx_dp_calefon"],
	activityMonth: ["spent"],
	recurring: ["recurring.cost.out.month"],
};

export function requiredFiguresFor(page: string): readonly string[] {
	return REQUIRED_FIGURES[page] ?? [];
}
