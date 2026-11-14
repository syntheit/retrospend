/**
 * The rows of the budget book family on a device (E2EE P13b): the person's
 * personal book and what hangs off it, the transfers a bill reads, and the
 * snapshot of what only the server can compute. Raw rows, as a sync sends
 * them and as the loaders of @retrospend/domain/envelope read them: decimals
 * are exact text, instants are Dates, enums stay the strings the database
 * holds. Each row keeps the fields the budget figures read; the contract's
 * other columns (timestamps, actors, undo state, caches a device rebuilds)
 * stay on the wire.
 */
import type { SplitBlock } from "@retrospend/domain/envelope/split-block";
import type { WithId } from "./port";

/** The personal book. A person has one; a shared book is never synced. */
export interface BudgetBookRow extends WithId {
	readonly currency: string;
	readonly style: string;
	readonly fundingSource: string;
	readonly pausedAt: Date | null;
	readonly weekStartDay: number;
	readonly timeZone: string;
	readonly startDate: Date;
	/** YYYYMM of the first month. */
	readonly startMonth: number;
	readonly defaultEnvelopeId: string | null;
	readonly startingBalanceExpenseId: string | null;
}

export interface EnvelopeGroupRow extends WithId {
	readonly bookId: string;
	readonly name: string;
	readonly sortOrder: number;
	readonly role: string | null;
	readonly targetKind: string;
	/** AMOUNT: in the book's currency; PERCENT_OF_INCOME: the percent. */
	readonly targetValue: string | null;
	readonly mainEnvelopeId: string | null;
	readonly archivedAt: Date | null;
}

export interface EnvelopeRow extends WithId {
	readonly bookId: string;
	readonly groupId: string | null;
	readonly name: string;
	readonly icon: string | null;
	readonly color: string | null;
	readonly kind: string;
	readonly sortOrder: number;
	readonly targetAmount: string | null;
	readonly targetMode: string;
	readonly targetCadence: string;
	readonly targetMonthlyAmount: string | null;
	/** Null is the book's currency. */
	readonly targetCurrency: string | null;
	readonly targetDueDate: Date | null;
	readonly targetRepeat: string | null;
	readonly targetStartMonth: number | null;
	readonly targetTemplateId: string | null;
	readonly targetLiabilityId: string | null;
	readonly leftoverRule: string;
	readonly leftoverSweepToId: string | null;
	readonly wealthAccountId: string | null;
	readonly wealthDedicated: boolean;
	readonly archivedAt: Date | null;
}

/** Which envelope a category feeds. */
export interface EnvelopeCategoryRow extends WithId {
	readonly bookId: string;
	readonly envelopeId: string;
	readonly categoryId: string;
}

/** The start day and rate type in force from a month on. */
export interface BookPeriodRow extends WithId {
	readonly bookId: string;
	readonly fromMonth: number;
	readonly startDay: number;
	readonly rateType: string;
}

/**
 * What a closed month left for the months after it: each envelope's leftover
 * rule and where a sweep goes, and which envelope each category fed. The
 * server's checkpoint is not here; a device rebuilds it.
 */
export interface CloseSummary {
	readonly envelopes: ReadonlyArray<{
		readonly id: string;
		readonly rule: string;
		readonly sweepToId: string | null;
	}>;
	readonly links?: Readonly<Record<string, string>>;
}

export interface MonthCloseRow extends WithId {
	readonly bookId: string;
	readonly month: number;
	readonly summary: CloseSummary;
}

/** The budget's half of a move between the budget and Wealth. */
export interface WealthTransferRow extends WithId {
	readonly bookId: string;
	readonly direction: string;
	/** Null is Not planned yet. */
	readonly envelopeId: string | null;
	readonly date: Date;
	/** In the book's currency. */
	readonly amount: string;
}

export interface PayoffPlanRow extends WithId {
	readonly bookId: string;
	readonly strategy: string;
	/** In the book's currency. */
	readonly extraMonthly: string;
	/** CUSTOM: the account ids in payoff order. */
	readonly customOrder: readonly string[];
	readonly envelopeId: string | null;
}

/** A move between accounts, as far as a bill reads it: what was paid to an account, and the fee expense. */
export interface TransferRow extends WithId {
	readonly date: Date;
	readonly toAccountId: string | null;
	readonly toAmount: string;
	readonly toCurrency: string;
	readonly feeExpenseId: string | null;
}

/** A value the server froze for one of the person's own expenses, by the key it depends on. */
export interface FrozenEntry {
	readonly key: string;
	readonly minor: number;
	readonly approximate: boolean;
}

/**
 * What only the server can compute for the budget, as GET /sync/shares?budget=1
 * last sent it (one row, id "budget"): the splits block and the frozen values
 * of the person's own expenses, with the key of the valuation they were made
 * under and the sync cursor they are exact at. No row means the device holds
 * none: Just track, a book others share, or never pulled with the block.
 */
export interface BudgetSnapshotRow extends WithId {
	readonly bookId: string;
	readonly valuationKey: string;
	readonly asOf: string;
	readonly frozen: readonly FrozenEntry[];
	readonly splits: SplitBlock;
}

/**
 * What an expense keeps for the budget filters (domain envelope/budget-rows.ts)
 * and the loaders, beyond the fields the spending rules read. Optional, since
 * rows of figures-only fixtures and of a device's own writes have none; a row
 * a sync applies has all of them.
 */
export interface ExpenseBookDetail {
	readonly isAmortizedChild?: boolean;
	readonly parentId?: string | null;
	/** INSTALLMENTS or REPORTS_ONLY. */
	readonly amortizeMode?: string;
	/** Income kept in Wealth stays out of Not planned yet. */
	readonly keepInWealth?: boolean;
	readonly recurringTemplateId?: string | null;
	/** Charged to this envelope whatever its category (a debt payment's interest). */
	readonly budgetEnvelopeId?: string | null;
}

/** The terms of a liability a bill and the payoff plan read, beyond what the account figures read. Optional like `ExpenseBookDetail`. */
export interface AccountTerms {
	/** Annual rate in percent. */
	readonly interestRate?: string | null;
	readonly minimumPayment?: string | null;
	/** Day of the month. */
	readonly dueDate?: number | null;
}
