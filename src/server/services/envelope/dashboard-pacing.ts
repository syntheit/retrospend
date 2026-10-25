/**
 * The dashboard's pace line from envelope totals (budget build plan P7),
 * replacing the old sum of category budgets. Pure over the month view the
 * budget page already shows, so the two always agree: money available to
 * spend this month (carried in plus assigned) against what has been spent,
 * for the envelopes that hold a limit or money, the same set "Left in your
 * limits" reads. Savings and goals are not spending; the variable part leaves
 * out the Bills group and bill envelopes (the old rule's fixed categories).
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { EnvelopePacing } from "~/lib/schemas/envelope-migration";

export function pacingOf(dto: GetMonthOutput): EnvelopePacing {
	const H = dto.book.currency;
	const total = { budget: 0, spent: 0 };
	const variable = { budget: 0, spent: 0 };
	for (const g of dto.groups) {
		for (const e of g.envelopes) {
			if (e.kind === "SAVINGS") continue;
			const available = e.carryIn.minor + e.assigned.minor;
			if (e.target === null && available === 0) continue;
			const budget = Math.max(0, available);
			const spent = Math.max(0, -e.activity.minor);
			total.budget += budget;
			total.spent += spent;
			if (g.role === "BILLS" || e.kind === "BILL") continue;
			variable.budget += budget;
			variable.spent += spent;
		}
	}
	const money = (minor: number) => ({ minor, currency: H });
	return {
		currency: H,
		month: dto.month.key,
		total: { budget: money(total.budget), spent: money(total.spent) },
		variable: { budget: money(variable.budget), spent: money(variable.spent) },
		daysLeft: dto.verdict.daysLeft,
		incomplete: dto.incomplete,
	};
}
