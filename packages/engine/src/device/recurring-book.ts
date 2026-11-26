import type { WriteFn } from "../local-db";
import { InvalidInputError } from "../port";
import {
	RECURRING_CONFIRM_MUTATION,
	RECURRING_SKIP_MUTATION,
} from "../preview";
import { confirmRecurring, skipRecurring } from "../recurring-local";
import { INCOME_NOT_ON_DEVICE } from "../template-local";
import type { ConfirmBody, SettleBody } from "./book";

// A person's confirm or skip of one due period, as the device books it: the
// engine's recurring mutations over the same inputs the server's twin takes.
// The device reads the period in the saved zone and checks no stamp: which
// template version the server holds is decided at send, and a device view
// that has moved on only makes this booking a refusal (the server decides).
//
// A person's income confirm or skip is not booked here: v1 answers an income
// confirm without a client id or a template stamp and the phone's income
// confirm carries options the device cannot book (the account, keep, the plan),
// so it stays online (M4, PR B). The engine's own confirm and skip do take an
// income template, which the poster plans (poster.ts).

/** A write that refuses an income template before it plans anything. */
const offIncome =
	(templateId: string, write: WriteFn<unknown>): WriteFn<unknown> =>
	(r) => {
		if (r.recurringTemplates.get(templateId)?.direction === "IN")
			throw new InvalidInputError(INCOME_NOT_ON_DEVICE);
		return write(r);
	};

/** The mutation of a confirm or skip, the figures it moves, and its write over `now`. */
export function recurringPlanOf(
	op:
		| { kind: "confirm"; body: ConfirmBody }
		| { kind: "skip"; body: SettleBody },
	now: Date,
) {
	const period = {
		templateId: op.body.templateId,
		now,
		dueAt: new Date(op.body.dueAt),
	};
	if (op.kind === "skip")
		return {
			id: RECURRING_SKIP_MUTATION.id,
			touches: RECURRING_SKIP_MUTATION.touches,
			write: offIncome(period.templateId, skipRecurring(period)),
		};
	return {
		id: RECURRING_CONFIRM_MUTATION.id,
		touches: RECURRING_CONFIRM_MUTATION.touches,
		write: offIncome(
			period.templateId,
			confirmRecurring({
				...period,
				clientId: op.body.expenseId,
				...(op.body.amount !== undefined
					? { confirmedAmount: op.body.amount }
					: {}),
				...(op.body.paidOn !== undefined ? { paidOn: op.body.paidOn } : {}),
			}),
		),
	};
}
