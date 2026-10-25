/**
 * Figure ids each page must render (SYNTHESIS-r5 §6 "Required keys"), keyed
 * by the page label the flows use. A page fails the audit when one is
 * missing, so deleting a tag cannot hide a mismatch. Today's pages carry no
 * figures yet; S4 adds each page's ids here as it tags them.
 */
import { MARTIN, PROJECT_IDS, SOFIA } from "../fixtures/personas";

const DEPTO = PROJECT_IDS.depto;
const FLORIPA = PROJECT_IDS.floripa;
const ME = `user:${SOFIA.id}`;

export const REQUIRED_FIGURES: Readonly<Record<string, readonly string[]>> = {
	dashboard: [],
	// S4A: the redesigned Home on Sofía's seed. The pool (budget.notPlannedYet)
	// shows only with an envelope book, which the seed does not have.
	home: ["glance.spent", "owed.owedToYou", "owed.youOwe", "netWorth"],
	transactions: [],
	people: [],
	// S4D: the redesigned People page (the smoke walk opens the old one).
	peoplePage: ["owed.owedToYou", "owed.youOwe"],
	projects: [],
	wealth: [],
	budget: [],
	// S4C: the redesigned Budget on a Flex book: the lead number
	// (the seed has no book; the flow sets one up for Martín).
	budgetPage: ["budget.leftToSpend"],
	settings: [],
	// The redesigned project pages (uiV2) on the seed: Sofía's balance in
	// each project on the list; the group total and her share on Depto
	// Palermo; her balance with Martín on its Summary. Their own keys, so
	// the smoke walk of today's pages (no figures) never requires them.
	"projects-v2": [
		`project.member.balance:${DEPTO}:${ME}`,
		`project.member.balance:${FLORIPA}:${ME}`,
	],
	"project-v2": [
		`project.total:${DEPTO}`,
		`project.member.share:${DEPTO}:${ME}`,
	],
	"project-v2-summary": [
		`project.total:${DEPTO}`,
		`balance.person:${DEPTO}:user:${MARTIN.id}`,
	],
	// S4B, as the flows open them: Martín's rows with Sofía, every month, and
	// his month view, whose footer is spent() for the month.
	activity: ["entry.amount:shared:e2e_tx_dp_calefon"],
	activityMonth: ["spent"],
	recurring: ["recurring.cost.out.month"],
	// S4G: the Add expense sheet with a foreign amount, audited inside the
	// sheet: the booked home value and the preview's spending line.
	addExpense: ["entry.home", "preview.spent.delta"],
	// S4B part 2: the Import review of the flow's CSV, whose first row is a
	// foreign amount: the original and the home value the import saves.
	import: ["import.amount:0", "import.home:0"],
};

export function requiredFiguresFor(page: string): readonly string[] {
	return REQUIRED_FIGURES[page] ?? [];
}
