import type {
	FigureDb,
	FigureNarrowing,
	FigureReading,
	Money,
} from "~/server/figures/registry";

/** Who the mutation runs as. The transaction is already scoped to this user (RLS). */
export interface Actor {
	readonly userId: string;
}

export interface RowRef {
	readonly table: string;
	readonly id: string;
}

/**
 * What a later undo needs (§2.4): the rows to revert, or the mirror movement
 * to book against the one this mutation wrote. Undo is a mutation too, with
 * its own preview; each money mutation defines its inverse when it lands.
 */
export type UndoToken =
	| {
			readonly kind: "revert";
			readonly mutation: string;
			readonly rows: readonly RowRef[];
	  }
	| {
			readonly kind: "mirror";
			readonly mutation: string;
			readonly movement: RowRef;
	  };

export interface MutationOutput<Value> {
	readonly value: Value;
	readonly undo: UndoToken;
}

/**
 * A money mutation: the one function that both previews and writes. It must
 * do all its work through `tx`; anything outside the database (emails,
 * notifications) belongs to the caller after `apply` resolves, because a
 * preview cannot roll it back.
 */
export interface MoneyMutation<Input, Value, Tx = FigureDb> {
	/** Stable id, for example `payment.record`. Undo tokens name it. */
	readonly id: string;
	/** Figure ids this mutation can change. Previews snapshot these plus the registry's every-preview figures. */
	readonly touches: readonly string[];
	/** Narrows the snapshot, for example to the person a payment is with. */
	readonly scope?: (input: Input) => FigureNarrowing;
	readonly run: (
		tx: Tx,
		input: Input,
		actor: Actor,
	) => Promise<MutationOutput<Value>>;
}

/** One currency line of a figure that moved. A side is null when the figure has no amount in that currency. */
export interface FigureChange {
	readonly id: string;
	readonly currency: string;
	readonly before: Money | null;
	readonly after: Money | null;
	/** after minus before, counting a missing side as zero. Always in `currency`: a diff never converts. */
	readonly delta: Money;
	/** Every currency line of the figure after the mutation, so a sheet can say "USD 20 stays". */
	readonly figureAfter: readonly Money[];
}

/** A figure none of whose currency lines moved, with what it holds. */
export interface FigureUnchanged {
	readonly id: string;
	readonly value: readonly Money[];
}

/**
 * A figure that could not be read on at least one side (for example a missing
 * rate, R14). It is never reported as a change or as unchanged, because
 * either claim would be a guess.
 */
export interface FigureUnavailable {
	readonly id: string;
	readonly before: FigureReading;
	readonly after: FigureReading;
}

/** R30: exactly what moves, what was checked and does not, and what could not be checked. */
export interface FiguresDiff {
	readonly changes: readonly FigureChange[];
	readonly unchanged: readonly FigureUnchanged[];
	readonly unavailable: readonly FigureUnavailable[];
}

export interface PreviewResult<Value> extends FiguresDiff {
	readonly value: Value;
	/** Figures that were converted totals (estimates) before or after the write. */
	readonly approx: readonly string[];
}

export interface ApplyResult<Value> extends PreviewResult<Value> {
	readonly undo: UndoToken;
}

export type TransactionPurpose = "preview" | "apply";

/** Opens one database transaction and runs `work` in it: commits when it resolves, rolls back when it throws. */
export type TransactionRunner<Tx> = <T>(
	work: (tx: Tx) => Promise<T>,
	purpose: TransactionPurpose,
) => Promise<T>;
