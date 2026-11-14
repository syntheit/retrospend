/**
 * Which of a person's own expense rows the budget counts (SPEC §5.2, §12.3):
 * the JS twin of the server's row filters (services/spending.ts
 * budgetSpendingWhere, budgetRefundWhere, budgetMoneyInWhere,
 * budgetClosedIncomeWhere, and inputs-source.ts leaving income categories out
 * of spending and refunds). A device holds the rows and applies these; the
 * server runs the Prisma filters. budget-rows.pg.test.ts holds the two to each
 * other over a generated cross product, so a change to either side fails there.
 *
 * Each rule reads as named clauses in the order the filter reads them: the
 * first clause a row fails is why it is out (`whyNot...`), and a row that fails
 * none is in. The reasons let the pg test prove every branch was exercised.
 *
 * A row's parent is looked up by id among the person's own rows. A parent that
 * is not there (not synced yet, or not the person's own, which row-level
 * security hides from the server's query too) counts as no parent: the child
 * is left out, never counted by guess.
 *
 * Hidden-from-reports rows (`excludeFromAnalytics`) are no clause here: the
 * budget counts the cash that left, so no budget filter reads that column.
 */

/** The columns of an expense the budget filters read. */
export interface BudgetRowFields {
	status: string;
	direction: string;
	entryKind: string;
	inType: string | null;
	/** Income kept in Wealth stays out of Not planned yet (MONEY-MOVES §2.2). */
	keepInWealth: boolean;
	isAmortizedParent: boolean;
	isAmortizedChild: boolean;
	parentId: string | null;
	amortizeMode: string;
	/** The kind of its category, null for none. */
	categoryKind: string | null;
	date: Date;
}

/** The parent of an amortized part, by id, among the person's own rows. */
export type ParentOf = (
	id: string,
) => Pick<BudgetRowFields, "amortizeMode"> | undefined;

/** The amortization branch that lets a spending row count. */
export type AmortizationBranch = "PLAIN" | "INSTALLMENT_PART" | "REPORTS_ONLY";

/**
 * Which branch of the amortization rule counts the row, or null when none
 * does. INSTALLMENTS purchases count each monthly part; REPORTS_ONLY purchases
 * count in full at purchase, so their parts are skipped.
 */
export function amortizationBranch(
	row: Pick<
		BudgetRowFields,
		"isAmortizedParent" | "isAmortizedChild" | "parentId" | "amortizeMode"
	>,
	parentOf: ParentOf,
): AmortizationBranch | null {
	if (!row.isAmortizedParent && !row.isAmortizedChild) return "PLAIN";
	if (
		row.isAmortizedChild &&
		row.parentId !== null &&
		parentOf(row.parentId)?.amortizeMode === "INSTALLMENTS"
	)
		return "INSTALLMENT_PART";
	if (row.isAmortizedParent && row.amortizeMode === "REPORTS_ONLY")
		return "REPORTS_ONLY";
	return null;
}

/** The money-in rule's branch that counts the row. */
export type MoneyInBranch = "INCOME" | "STARTING_BALANCE_OR_ADJUSTMENT";

const isStandardIncome = (
	row: Pick<BudgetRowFields, "direction" | "entryKind" | "inType">,
) =>
	row.direction === "IN" &&
	row.entryKind === "STANDARD" &&
	row.inType === "INCOME";

/**
 * Income entering Not planned yet, the starting balance and adjustments (an
 * OUT adjustment lowers it). Refunds are envelope Activity; own transfers
 * (NOT_SPENDING) are nothing. Income kept in Wealth is not in it: a Move in
 * counts it through the budget side.
 */
export function moneyInBranch(
	row: Pick<
		BudgetRowFields,
		"direction" | "entryKind" | "inType" | "keepInWealth"
	>,
): MoneyInBranch | null {
	if (isStandardIncome(row) && !row.keepInWealth) return "INCOME";
	if (row.entryKind === "STARTING_BALANCE" || row.entryKind === "ADJUSTMENT")
		return "STARTING_BALANCE_OR_ADJUSTMENT";
	return null;
}

type Clauses = ReadonlyArray<readonly [string, boolean]>;

const firstMiss = (clauses: Clauses): string | null =>
	clauses.find(([, holds]) => !holds)?.[0] ?? null;

const onOrAfter = (d: Date, from: Date) => d.getTime() >= from.getTime();

const notIncomeCategory = (row: Pick<BudgetRowFields, "categoryKind">) =>
	row.categoryKind !== "INCOME";

/** The reason a row that is not money in is not, naming the row kept in Wealth apart. */
const moneyInClause = (row: BudgetRowFields) =>
	[
		isStandardIncome(row) && row.keepInWealth
			? "KEPT_IN_WEALTH"
			: "NOT_MONEY_IN",
		moneyInBranch(row) !== null,
	] as const;

/** Why a row is not budget spending, or null when it is. */
export function whyNotSpending(
	row: BudgetRowFields,
	parentOf: ParentOf,
	from: Date,
): string | null {
	return firstMiss([
		["NOT_FINALIZED", row.status === "FINALIZED"],
		["NOT_OUT", row.direction === "OUT"],
		["NOT_STANDARD", row.entryKind === "STANDARD"],
		["BEFORE_FROM", onOrAfter(row.date, from)],
		["AMORTIZATION", amortizationBranch(row, parentOf) !== null],
		["INCOME_CATEGORY", notIncomeCategory(row)],
	]);
}

/** Why a row is not a budget refund, or null when it is. */
export function whyNotRefund(row: BudgetRowFields, from: Date): string | null {
	return firstMiss([
		["NOT_FINALIZED", row.status === "FINALIZED"],
		["NOT_IN", row.direction === "IN"],
		["NOT_STANDARD", row.entryKind === "STANDARD"],
		["NOT_REFUND", row.inType === "REFUND"],
		["BEFORE_FROM", onOrAfter(row.date, from)],
		["INCOME_CATEGORY", notIncomeCategory(row)],
	]);
}

/** Why a row is not budget money in dated from `from`, or null when it is. */
export function whyNotMoneyIn(row: BudgetRowFields, from: Date): string | null {
	return firstMiss([
		["NOT_FINALIZED", row.status === "FINALIZED"],
		["BEFORE_FROM", onOrAfter(row.date, from)],
		moneyInClause(row),
	]);
}

/**
 * Why a row is not income of a closed month, or null when it is: money in
 * dated from `from` up to, not including, `to`, standard entries only (a
 * starting balance or an adjustment is never typical income).
 */
export function whyNotClosedIncome(
	row: BudgetRowFields,
	from: Date,
	to: Date,
): string | null {
	return firstMiss([
		["NOT_FINALIZED", row.status === "FINALIZED"],
		["NOT_STANDARD", row.entryKind === "STANDARD"],
		["BEFORE_FROM", onOrAfter(row.date, from)],
		["FROM_TO", row.date.getTime() < to.getTime()],
		moneyInClause(row),
	]);
}

export const isBudgetSpending = (
	row: BudgetRowFields,
	parentOf: ParentOf,
	from: Date,
) => whyNotSpending(row, parentOf, from) === null;

export const isBudgetRefund = (row: BudgetRowFields, from: Date) =>
	whyNotRefund(row, from) === null;

export const isBudgetMoneyIn = (row: BudgetRowFields, from: Date) =>
	whyNotMoneyIn(row, from) === null;

export const isClosedIncome = (row: BudgetRowFields, from: Date, to: Date) =>
	whyNotClosedIncome(row, from, to) === null;
