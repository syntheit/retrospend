/**
 * Bill cycles (02 §3.5, D26): which due date this month's bill need aims at,
 * with the 7-day grace for bills that follow a recurring expense and the
 * paid-early rule (S9).
 */
import { addDays, addMonthsToDate } from "./calendar";
import type { IsoDate, Minor } from "./types";

export interface BillCycleInput {
	amount: Minor;
	/** The anchor due date: the template's nextDueDate when linked (D26). */
	nextDue: IsoDate;
	/** Months between dues; null for a one-off bill. */
	repeatMonths: number | null;
	monthStart: IsoDate;
	today: IsoDate;
	/** Follows a recurring expense: stays open until it posts or 7 days pass (D26). */
	linkedToTemplate: boolean;
	/** Activity in this envelope since the previous due date. */
	paidThisCycle: Minor;
}

export const BILL_GRACE_DAYS = 7;

/** True when the cycle's activity reached 90% of the amount (paid early, S9). */
export function paidEnough(paid: Minor, amount: Minor): boolean {
	return amount > 0 && paid * 10 >= amount * 9;
}

/**
 * The due date D' this month's bill need aims at (02 §3.5): the next due on
 * or after the month start; a linked bill still inside its 7-day grace keeps
 * its late due date; a cycle already paid to 90% advances one repeat.
 */
export function billCycle(b: BillCycleInput): { due: IsoDate; done: boolean } {
	let k = 0;
	const dueAt = (i: number) =>
		b.repeatMonths ? addMonthsToDate(b.nextDue, i * b.repeatMonths) : b.nextDue;
	const inGrace = (d: IsoDate) =>
		b.linkedToTemplate && b.today <= addDays(d, BILL_GRACE_DAYS);
	if (b.repeatMonths) {
		while (dueAt(k) < b.monthStart && !inGrace(dueAt(k))) k++;
	}
	if (!paidEnough(b.paidThisCycle, b.amount))
		return { due: dueAt(k), done: false };
	if (!b.repeatMonths) return { due: b.nextDue, done: true };
	return { due: dueAt(k + 1), done: false };
}
