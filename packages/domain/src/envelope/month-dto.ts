/**
 * Engine figures to contract DTOs for the month view (month-view.ts): every
 * minor amount becomes the Money DTO in the book currency.
 */
import type { LeftToSpendDto, MoneyDto, VerdictDto } from "./dto";
import type { LeftToSpend } from "./pace";
import type { Minor } from "./types";
import type { Verdict } from "./verdict";

export function verdictDto(
	v: Verdict,
	money: (v: Minor) => MoneyDto,
	incomplete: boolean,
): VerdictDto {
	return {
		...v,
		lead: { ...v.lead, amount: money(v.lead.amount) },
		perDay: money(v.perDay),
		over: money(v.over),
		overEnvelopes: v.overEnvelopes.map((e) => ({
			id: e.id,
			over: money(e.over),
		})),
		billsShort: money(v.billsShort),
		plannedTooMuch: money(v.plannedTooMuch),
		notice: v.notice ? { ...v.notice, amount: money(v.notice.amount) } : null,
		limits: v.limits
			? { limit: money(v.limits.limit), spent: money(v.limits.spent) }
			: null,
		incomplete,
	};
}

export function leftToSpendDto(
	l: LeftToSpend,
	money: (v: Minor) => MoneyDto,
): LeftToSpendDto {
	return {
		left: money(l.left),
		perDay: money(l.perDay),
		daysLeft: l.daysLeft,
		carry: money(l.carry),
		assigned: money(l.assigned),
		spent: money(l.spent),
		plannedTooMuch: money(l.plannedTooMuch),
		over: money(l.over),
		billsHeld: money(l.billsHeld),
		billsShort: money(l.billsShort),
		billsCount: l.billsCount,
		savings: money(l.savings),
		notPlanned: money(l.notPlanned),
		fasterThanPlanned: l.fasterThanPlanned,
	};
}
