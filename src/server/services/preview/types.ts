import type {
	ApplyResult as CoreApplyResult,
	MoneyMutation as CoreMoneyMutation,
	MutationOutput as CoreMutationOutput,
} from "@retrospend/domain/figures/preview";
import type { FigureDb } from "~/server/figures/registry";

// The preview vocabulary is shared with the device runner and lives in
// @retrospend/domain; the server keeps its import path and its own undo token.
export type {
	FigureChange,
	FiguresDiff,
	FigureUnchanged,
	UnavailableFigure as FigureUnavailable,
} from "@retrospend/domain/figures/diff";
export type {
	Actor,
	PreviewResult,
	TransactionPurpose,
	TransactionRunner,
} from "@retrospend/domain/figures/preview";

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

export type MutationOutput<Value> = CoreMutationOutput<Value, UndoToken>;

/** The core's mutation with the server's undo token and, by default, the Prisma transaction. */
export type MoneyMutation<Input, Value, Tx = FigureDb> = CoreMoneyMutation<
	Input,
	Value,
	Tx,
	UndoToken
>;

export type ApplyResult<Value> = CoreApplyResult<Value, UndoToken>;
