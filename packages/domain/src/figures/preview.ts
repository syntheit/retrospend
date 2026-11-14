/**
 * The preview runner core, generic over the transaction (`Tx`) and the undo
 * token (`Undo`): the server runs it on Prisma transactions with row-ref
 * tokens, the device on its local store with before and after rows. Both run
 * the real write inside a transaction that rolls back, so a preview is the
 * write itself, never a second implementation (I22, RC-1).
 */

import { diffSnapshots, type FiguresDiff } from "./diff";
import {
	convertedIn,
	type FigureDefinition,
	type FigureNarrowing,
	FigurePass,
	type FigureScope,
	type FiguresRegistry,
	readFiguresIn,
} from "./registry";

/** Who the mutation runs as. The transaction is already scoped to this user. */
export interface Actor {
	readonly userId: string;
}

export interface MutationOutput<Value, Undo> {
	readonly value: Value;
	readonly undo: Undo;
}

/**
 * A money mutation: the one function that both previews and writes. It must
 * do all its work through `tx`; anything outside the database (emails,
 * notifications) belongs to the caller after `apply` resolves, because a
 * preview cannot roll it back.
 */
export interface MoneyMutation<Input, Value, Tx, Undo> {
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
	) => Promise<MutationOutput<Value, Undo>>;
}

export interface PreviewResult<Value> extends FiguresDiff {
	readonly value: Value;
	/** Figures that were converted totals (estimates) before or after the write. */
	readonly approx: readonly string[];
}

export interface ApplyResult<Value, Undo> extends PreviewResult<Value> {
	readonly undo: Undo;
}

export type TransactionPurpose = "preview" | "apply";

/** Opens one transaction and runs `work` in it: commits when it resolves, rolls back when it throws. */
export type TransactionRunner<Tx> = <T>(
	work: (tx: Tx) => Promise<T>,
	purpose: TransactionPurpose,
) => Promise<T>;

export interface PreviewRunnerDeps<Tx, Undo> {
	readonly figures: FiguresRegistry<Tx>;
	/**
	 * Must be scoped to `actor` (RLS on the server), so figures and the
	 * mutation see only that user's rows. Told whether it runs a preview or an
	 * apply, so it can pick the isolation level for each.
	 */
	readonly transaction: TransactionRunner<Tx>;
	readonly actor: Actor;
	/**
	 * Wraps the whole preview transaction so the side that needs to know it is
	 * inside a preview can say so (the server's `insidePreview` stops sealing
	 * from making a key there). Required, not optional, so no runner can forget
	 * it; a side with nothing to mark passes the identity.
	 */
	readonly markPreview: <T>(work: () => Promise<T>) => Promise<T>;
	/**
	 * Runs inside the apply transaction after the mutation and its figure diff
	 * succeeded, so what it writes commits or rolls back with the mutation (the
	 * event outbox). Returns whether it wrote anything. Never runs for previews.
	 */
	readonly onApplied?: (
		tx: Tx,
		mutation: { readonly id: string },
		result: ApplyResult<unknown, Undo>,
		actor: Actor,
	) => Promise<boolean>;
	/** Called once after an apply whose `onApplied` wrote something has committed. */
	readonly afterCommit?: (actor: Actor) => void;
}

export interface PreviewRunner<Tx, Undo> {
	/** Runs the mutation and reports what it would change. Never commits. */
	preview<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx, Undo>,
		input: Input,
	): Promise<PreviewResult<Value>>;
	/** Runs the same mutation, commits it and reports what it changed. */
	apply<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx, Undo>,
		input: Input,
	): Promise<ApplyResult<Value, Undo>>;
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
async function runMeasured<Tx, Input, Value, Undo>(
	tx: Tx,
	mutation: MoneyMutation<Input, Value, Tx, Undo>,
	input: Input,
	definitions: readonly FigureDefinition<Tx>[],
	actor: Actor,
): Promise<ApplyResult<Value, Undo>> {
	// userId last, so an input-derived narrowing can never widen the snapshot to another user.
	const scope: FigureScope = {
		...mutation.scope?.(input),
		userId: actor.userId,
	};
	// One read pass per side, so a figure that asks whether it is converted
	// reuses what the reading loaded.
	const beforePass = new FigurePass();
	const before = await readFiguresIn(tx, definitions, scope, beforePass);
	const estimatedBefore = await convertedIn(tx, definitions, scope, beforePass);
	const { value, undo } = await mutation.run(tx, input, actor);
	const afterPass = new FigurePass();
	const after = await readFiguresIn(tx, definitions, scope, afterPass);
	const estimatedAfter = await convertedIn(tx, definitions, scope, afterPass);
	return {
		value,
		undo,
		approx: [...new Set([...estimatedBefore, ...estimatedAfter])].sort(),
		...diffSnapshots(before, after),
	};
}

export function createPreviewRunnerCore<Tx, Undo>({
	figures,
	transaction,
	actor,
	markPreview,
	onApplied,
	afterCommit,
}: PreviewRunnerDeps<Tx, Undo>): PreviewRunner<Tx, Undo> {
	async function preview<Input, Value>(
		mutation: MoneyMutation<Input, Value, Tx, Undo>,
		input: Input,
	): Promise<PreviewResult<Value>> {
		const definitions = figuresFor(figures, mutation.touches);
		try {
			// Marked here, not by each runner's options, so no runner can forget.
			await transaction(
				(tx) =>
					markPreview(async () => {
						const { undo: _rolledBack, ...result } = await runMeasured(
							tx,
							mutation,
							input,
							definitions,
							actor,
						);
						throw new PreviewRollback(result);
					}),
				"preview",
			);
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
		mutation: MoneyMutation<Input, Value, Tx, Undo>,
		input: Input,
	): Promise<ApplyResult<Value, Undo>> {
		const definitions = figuresFor(figures, mutation.touches);
		let wrote = false;
		const result = await transaction(async (tx) => {
			const applied = await runMeasured(
				tx,
				mutation,
				input,
				definitions,
				actor,
			);
			wrote = (await onApplied?.(tx, mutation, applied, actor)) ?? false;
			return applied;
		}, "apply");
		if (wrote) afterCommit?.(actor);
		return result;
	}

	return { preview, apply };
}
