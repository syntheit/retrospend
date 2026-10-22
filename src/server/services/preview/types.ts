import type {
	FigureDb,
	FigureNarrowing,
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

export interface FigureChange {
	readonly id: string;
	readonly before: Money | null;
	readonly after: Money | null;
	/** null when either side is unavailable or the currencies differ: a diff never converts. */
	readonly delta: Money | null;
}

export interface FigureUnchanged {
	readonly id: string;
	readonly value: Money | null;
}

/** R30: exactly what moves, and what was checked and does not. */
export interface FiguresDiff {
	readonly changes: readonly FigureChange[];
	readonly unchanged: readonly FigureUnchanged[];
}

export interface PreviewResult<Value> extends FiguresDiff {
	readonly value: Value;
}

export interface ApplyResult<Value> extends PreviewResult<Value> {
	readonly undo: UndoToken;
}

/** Opens one database transaction and runs `work` in it: commits when it resolves, rolls back when it throws. */
export type TransactionRunner<Tx> = <T>(
	work: (tx: Tx) => Promise<T>,
) => Promise<T>;
