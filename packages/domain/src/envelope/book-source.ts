/**
 * What the budget loader reads (load-book.ts) and what it returns. A source
 * answers for one person's personal book: the server implements it over
 * Postgres through the caller's transaction (server/services/envelope/
 * inputs.ts), a device over its own store. A source reads and groups; it
 * never values, rounds or writes. What a read would have written on the
 * server (freezing first values, a stale mark) comes back as data from the
 * load, for the caller to store.
 *
 * The row types are the columns the loader reads; the server's rows have
 * more (relations, undo payloads), so the loader is generic over them and a
 * caller keeps its own row type on `LoadedBook.row`.
 */
import type { AssetType } from "../accounts/places";
import type { Decimal } from "../precise-decimal";
import type { StoredCheckpoint } from "./checkpoint";
import type { EngineInput, LeftoverRule } from "./engine";
import type { BudgetInputsPort } from "./inputs-port";
import type { ViewBook } from "./month-view";
import type { MonthBoundary } from "./months";
import type { ShareSide, SplitBlock } from "./split-block";
import type { LoadedSplits, SplitInputs } from "./splits-input";
import type {
	LiabilityTerms,
	StoredTarget,
	TemplateTerms,
} from "./target-input";
import type { GroupTargetKind, IsoDate, MissingRate, MonthKey } from "./types";
import type { ValuationContext } from "./valuation";
import type { ApproximateRow, FrozenValue, Valuer } from "./valuer";
import type { BudgetStyle } from "./verdict";

export interface BookEnvelopeRow extends StoredTarget {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
	groupId: string | null;
	sortOrder: number;
	archivedAt: Date | null;
	targetStartMonth: MonthKey | null;
	wealthDedicated: boolean;
	wealthAccountId: string | null;
	leftoverRule: LeftoverRule;
	leftoverSweepToId: string | null;
	categories: ReadonlyArray<{ categoryId: string }>;
}

export interface BookGroupRow {
	id: string;
	name: string;
	role: "BILLS" | "SPENDING" | "SAVINGS" | null;
	sortOrder: number;
	targetKind: GroupTargetKind;
	targetValue: Decimal | null;
	mainEnvelopeId: string | null;
}

/** The personal book with its periods, live groups and envelopes with their category links. */
export interface BookRowCore {
	id: string;
	createdById: string;
	currency: string;
	style: BudgetStyle;
	fundingSource: "INCOME" | "TARGETS";
	pausedAt: Date | null;
	weekStartDay: number;
	timeZone: string;
	startDate: Date;
	startMonth: MonthKey;
	defaultEnvelopeId: string | null;
	startingBalanceExpenseId: string | null;
	periods: ReadonlyArray<{
		fromMonth: MonthKey;
		startDay: number;
		rateType: string;
	}>;
	groups: readonly BookGroupRow[];
	envelopes: readonly BookEnvelopeRow[];
}

/** A closed month as the loader reads it: its rules, its category links and the checkpoint a pass may start at. */
export interface CloseRowCore {
	month: MonthKey;
	summary: {
		envelopes: ReadonlyArray<{
			id: string;
			rule: LeftoverRule;
			sweepToId: string | null;
		}>;
		links?: Record<string, string>;
	};
	checkpoint: StoredCheckpoint | null;
}

/** A budget_dirty mark: a change a checkpoint did not see. */
export interface DirtyMark {
	id: bigint;
	fromMonth: number;
	/** When the change was made: the late window counts from here (C17). */
	createdAt: Date;
}

/** An account a savings goal follows ("Only for this goal"). */
export interface DedicatedAccount {
	id: string;
	type: AssetType;
	balance: Decimal;
	currency: string;
	exchangeRateType: string | null;
}

export interface BookSource<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> {
	/** The user's personal book (one per user, D33), or null for "Just track". */
	book(): Promise<R | null>;
	/** The port for one book's rows, movements, Wealth moves and rates. */
	inputs(row: R): BudgetInputsPort;
	/** Every close of the book, oldest first. */
	closes(row: R): Promise<C[]>;
	dirtyMarks(row: R): Promise<DirtyMark[]>;
	/** Foreign rows' values frozen by earlier loads. */
	frozenValues(row: R): Promise<ReadonlyMap<string, FrozenValue>>;
	/** What bills follow outside the book; read only when an envelope names one. */
	targetSources(
		row: R,
		today: IsoDate,
	): Promise<{ templates: TemplateTerms[]; liabilities: LiabilityTerms[] }>;
	/** The accounts dedicated goals follow (none when the book has none). */
	dedicatedAccounts(row: R): Promise<DedicatedAccount[]>;
	/** Every split row of the person, full history (the replay needs every debt from its start). */
	splits(row: R): Promise<SplitInputs>;
	/**
	 * The splits as a block the server computed, for a source that does not
	 * hold the rows (a device). When present the loader uses it instead of
	 * `splits` and replays nothing: the block is the replay's answer.
	 */
	splitBlock?(row: R): Promise<SplitBlock>;
	/** A stable string hash for the fingerprints of fully loaded rows (checkpoint.ts). */
	hash(text: string): string;
}

export interface LoadedBook<
	R extends BookRowCore = BookRowCore,
	C extends CloseRowCore = CloseRowCore,
> {
	row: R;
	book: ViewBook;
	input: EngineInput;
	today: IsoDate;
	missingRates: MissingRate[];
	/** Foreign rows valued at the nearest rate, not one dated on or before them ("≈"). */
	approximate: ApproximateRow[];
	splits: LoadedSplits;
	/** What the share side of the load produced: own shares as entries and the rates it lacked (a splits block is made from it). */
	shareSide: ShareSide;
	/** Every close of the book, oldest first. */
	closes: C[];
	/** budget_dirty marks seen by this load. */
	dirty: DirtyMark[];
	/** The checkpoint the pass starts at, or null for a pass from the start. */
	checkpoint: StoredCheckpoint | null;
	/** Fingerprints of the fully loaded rows per month up to last month (checkpoint.ts). */
	prints: ReadonlyMap<MonthKey, string>;
	periods: MonthBoundary[];
	/** The book currency, periods and rates this load valued rows with. */
	valuation: ValuationContext;
	/** Values further rows the same way (rules, typical income); what it values first is frozen. */
	valuer: Valuer;
}
