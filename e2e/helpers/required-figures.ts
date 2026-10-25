/**
 * Figure ids each page must render (SYNTHESIS-r5 §6 "Required keys"), keyed
 * by the page label the flows use. A page fails the audit when one is
 * missing, so deleting a tag cannot hide a mismatch. A page with no entry
 * here (the smoke walk's pages) has no required ids.
 */
import { MARTIN, PROJECT_IDS, SOFIA, seedId } from "../fixtures/personas";

const DEPTO = PROJECT_IDS.depto;
const FLORIPA = PROJECT_IDS.floripa;
const ME = `user:${SOFIA.id}`;
const RENT = seedId("cat", "sofia", "rent");

export const REQUIRED_FIGURES: Readonly<Record<string, readonly string[]>> = {
	// S4A: Home on Sofía's seed. The pool (budget.notPlannedYet)
	// shows only with an envelope book, which the seed does not have.
	home: [
		"glance.spent",
		"owed.owedToYou",
		"owed.youOwe",
		"netWorth",
		"rate.dollarToday",
	],
	// S4D: the People page.
	peoplePage: ["owed.owedToYou", "owed.youOwe"],
	// S4C: the Budget page on a Flex book: the lead number
	// (the seed has no book; the flow sets one up for Martín).
	budgetPage: ["budget.leftToSpend", "budget.moneyIn"],
	// The project pages on the seed: Sofía's balance in
	// each project on the list; the group total and her share on Depto
	// Palermo; her balance with Martín on its Summary.
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
	// S4A part 2: Insights on Sofía's seed, as the flow opens it: this month's
	// total, rent, the year to date and the cashflow; in USD at the rate each
	// expense was saved with; and a range with Compare.
	insights: [
		"insights.spent",
		`insights.byCategory:${RENT}`,
		"insights.ytd",
		`insights.ytdByCategory:${RENT}`,
		"insights.income",
		"insights.saved",
		"insights.dailyAverage",
		"insights.monthlyAverage",
	],
	insightsUsd: ["insights.ytdUsd", `insights.ytdByCategoryUsd:${RENT}`],
	insightsCompare: ["insights.spent", "insights.spentPrevious"],
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
