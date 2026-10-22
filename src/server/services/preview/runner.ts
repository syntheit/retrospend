import {
	type FigureDefinition,
	type FigureScope,
	type FiguresRegistry,
	readFiguresIn,
} from "~/server/figures/registry";
import { diffSnapshots } from "./diff";
import type {
	Actor,
	ApplyResult,
	MoneyMutation,
	PreviewResult,
	TransactionRunner,
} from "./types";

export interface PreviewRunnerDeps<Tx> {
	readonly figures: FiguresRegistry<Tx>;
	/**
	 * Must be scoped to `actor` (RLS), so figures and the mutation see only that
	 * user's rows. Told whether it runs a preview or an apply, so it can pick
	 * the isolation level for each.
	 */
	readonly transaction: TransactionRunner<Tx>;
	readonly actor: Actor;
}

export interface PreviewRunner<Tx> {
	/** Runs the mutation and reports what it would change. Never commits. */
	preview<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx>,
		input: Input,
	): Promise<PreviewResult<Value>>;
	/** Runs the same mutation, commits it and reports what it changed. */
	apply<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx>,
		input: Input,
	): Promise<ApplyResult<Value>>;
}

/**
 * Thrown as the last step of every preview so the transaction runner rolls
 * back whatever the mutation wrote. Module-private and thrown only after the
 * mutation has returned, so no mutation or figure can fake or intercept it.
 */
class PreviewRollback<Value> extends Error {
	constructor(readonly result: PreviewResult<Value>) {
		super("preview rollback");
		this.name = "PreviewRollback";
	}
}

/** The declared figures plus the every-preview ones, resolved before any transaction opens so an unknown id fails fast. */
function figuresFor<Tx>(
	figures: FiguresRegistry<Tx>,
	touches: readonly string[],
): FigureDefinition<Tx>[] {
	const ids = new Set([...touches, ...figures.inEveryPreview]);
	return [...ids].map((id) => figures.get(id));
}

/** The single code path behind both preview and apply, so preview = result by construction (I22, RC-1). */
async function runMeasured<Tx, Input, Value>(
	tx: Tx,
	mutation: MoneyMutation<Input, Value, Tx>,
	input: Input,
	definitions: readonly FigureDefinition<Tx>[],
	actor: Actor,
): Promise<ApplyResult<Value>> {
	// userId last, so an input-derived narrowing can never widen the snapshot to another user.
	const scope: FigureScope = {
		...mutation.scope?.(input),
		userId: actor.userId,
	};
	const before = await readFiguresIn(tx, definitions, scope);
	const { value, undo } = await mutation.run(tx, input, actor);
	const after = await readFiguresIn(tx, definitions, scope);
	return { value, undo, ...diffSnapshots(before, after) };
}

export function createPreviewRunner<Tx>({
	figures,
	transaction,
	actor,
}: PreviewRunnerDeps<Tx>): PreviewRunner<Tx> {
	async function preview<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx>,
		input: Input,
	): Promise<PreviewResult<Value>> {
		const definitions = figuresFor(figures, mutation.touches);
		try {
			await transaction(async (tx) => {
				const { undo: _rolledBack, ...result } = await runMeasured(
					tx,
					mutation,
					input,
					definitions,
					actor,
				);
				throw new PreviewRollback(result);
			}, "preview");
		} catch (error) {
			if (error instanceof PreviewRollback) {
				return error.result as PreviewResult<Value>;
			}
			throw error;
		}
		// Only reachable if the runner swallowed the rollback, in which case it may have committed.
		throw new Error(
			`preview of ${mutation.id} finished without rolling back its transaction`,
		);
	}

	async function apply<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx>,
		input: Input,
	): Promise<ApplyResult<Value>> {
		const definitions = figuresFor(figures, mutation.touches);
		return transaction(
			(tx) => runMeasured(tx, mutation, input, definitions, actor),
			"apply",
		);
	}

	return { preview, apply };
}
