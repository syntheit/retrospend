import {
	RECURRING_CONFIRM_MUTATION,
	RECURRING_SKIP_MUTATION,
} from "../preview";
import { confirmRecurring, skipRecurring } from "../recurring-local";
import type { ConfirmBody, SettleBody } from "./book";

// A person's confirm or skip of one due period, as the device books it: the
// engine's recurring mutations over the same inputs the server's twin takes.
// The device reads the period in the saved zone and checks no stamp: which
// template version the server holds is decided at send, and a device view
// that has moved on only makes this booking a refusal (the server decides).

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
			write: skipRecurring(period),
		};
	return {
		id: RECURRING_CONFIRM_MUTATION.id,
		touches: RECURRING_CONFIRM_MUTATION.touches,
		write: confirmRecurring({
			...period,
			clientId: op.body.expenseId,
			...(op.body.amount !== undefined
				? { confirmedAmount: op.body.amount }
				: {}),
			...(op.body.paidOn !== undefined ? { paidOn: op.body.paidOn } : {}),
		}),
	};
}
