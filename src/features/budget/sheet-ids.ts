/**
 * The Budget sheets, by id. The page (src/features/budget/page) opens a
 * sheet with `useBudgetSheet()(id, args)`; the sheets agent fills the
 * renderer for each id in `sheet-registry.tsx`. Both sides import only this
 * file for the ids and their arguments, so neither knows the other.
 *
 * Ids follow the mockup's actions (mockups/budget.html, `Kit.do['bx-*']`).
 * `month` is always the month the page shows (YYYYMM). Money is never an
 * argument: a sheet reads what it needs from the server (R9). The two
 * exceptions are an amount a button already names ("Fund 120,000"), which
 * prefills the sheet's own input and is checked again on the server.
 */

export const BUDGET_SHEET_IDS = [
	/** Assign money to envelopes (To assign or Not planned yet). */
	"assign",
	/** Take back what was given out above what you have (negative pool). */
	"takeBack",
	/** Add money in (income, a move from Wealth). */
	"addIncome",
	/** Use my plan: fill envelopes from the saved plan, then the rest. */
	"usePlan",
	/** A recurring income arrived: put it to work. */
	"incomeArrived",
	/** Cover every overspent envelope. */
	"coverAll",
	/** Cover one overspent envelope. */
	"cover",
	/** Move money between envelopes, or in and out of the pool. */
	"move",
	/** An envelope's target. */
	"target",
	/** Raise one limit (Limits style). */
	"raiseLimit",
	/** Set a limit on an envelope (Limits style). */
	"setLimit",
	/** What if I spend...: a draft with pretend rows. */
	"whatIf",
	/** Move an envelope's money to Wealth. */
	"toWealth",
	/** Move money from Wealth into the budget. */
	"fromWealth",
	/** Rename an envelope or edit its categories. */
	"editEnvelope",
	/** Add an envelope. */
	"newEnvelope",
	/** Combine envelopes. */
	"mergeEnvelopes",
	/** Budget style, with the preview of what changes. */
	"style",
	/** What the words mean. */
	"help",
	/** Income rules. */
	"rules",
	/** The income block: expected, received, kept in Wealth. */
	"income",
	/** The payoff plan (debts). */
	"debt",
	/** Pay down a debt. */
	"payDebt",
	/** Can I afford something? */
	"afford",
	/** Shares waiting for your OK or without an envelope. */
	"splits",
	/** Who owes you, and Settle up or Forgive from there. */
	"owed",
	/** Settle up with one person from the budget. */
	"settle",
	/** Confirm a payment someone says they made. */
	"confirmPayment",
	/** The month summary of a closed month. */
	"monthSummary",
	/** How a figure adds up (To assign, Left, Activity, a group total). */
	"explain",
	/** Plan next month: edit one envelope's planned amount in the draft. */
	"planEdit",
	/** Plan next month: apply the draft. */
	"planApply",
	/** Plan next month: fund it now from what you have. */
	"fundNow",
	/** Welcome back after time away. */
	"welcomeBack",
	/** Set up your budget (the first run). */
	"setup",
	/** Starting money prompt of a migrated budget. */
	"startingMoney",
] as const;

export type BudgetSheetId = (typeof BUDGET_SHEET_IDS)[number];

type WithMonth = { month: number };
type ForEnvelope = WithMonth & { envelopeId: string };

/** What each sheet gets when the page opens it. */
export type BudgetSheetArgs = {
	assign: WithMonth;
	takeBack: WithMonth;
	addIncome: WithMonth;
	usePlan: WithMonth;
	incomeArrived: WithMonth & { expenseId: string };
	coverAll: WithMonth;
	cover: ForEnvelope;
	/**
	 * `direction: "in"` fills the envelope (the Fund button on a short bill),
	 * `amountMinor` is that button's suggestion (prefill only).
	 */
	move: WithMonth & {
		envelopeId?: string;
		direction?: "in" | "out";
		amountMinor?: number;
	};
	target: ForEnvelope & { advanced?: boolean };
	raiseLimit: ForEnvelope;
	setLimit: WithMonth;
	whatIf: WithMonth & { envelopeId?: string };
	toWealth: ForEnvelope;
	fromWealth: WithMonth & { envelopeId?: string };
	editEnvelope: ForEnvelope;
	newEnvelope: WithMonth;
	mergeEnvelopes: WithMonth;
	style: WithMonth;
	help: WithMonth;
	rules: WithMonth;
	income: WithMonth;
	debt: WithMonth;
	payDebt: WithMonth & { envelopeId?: string; liabilityId?: string };
	afford: WithMonth;
	splits: WithMonth;
	owed: WithMonth;
	settle: WithMonth & { personKey: string };
	confirmPayment: WithMonth & { paymentId: string };
	monthSummary: WithMonth;
	/**
	 * `figure` is the registry id of the number tapped ("budget.notPlannedYet",
	 * "budget.leftToSpend", "envelope.left"); `envelopeId` narrows it.
	 */
	explain: WithMonth & {
		figure: string;
		envelopeId?: string;
		groupId?: string;
	};
	planEdit: ForEnvelope;
	planApply: WithMonth;
	fundNow: WithMonth;
	welcomeBack: WithMonth;
	setup: WithMonth;
	startingMoney: WithMonth;
};
