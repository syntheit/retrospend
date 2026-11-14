/**
 * The device preview runner (E2EE P13): the same runner core the server uses
 * (@retrospend/domain/figures/preview), on the device store. A preview runs
 * the real write inside a store transaction that rolls back, reading the
 * figures through that transaction before and after, so the sheet that says
 * what Save would change is made by the code Save runs (I22, RC-1). Apply
 * runs it again and commits; the diff it returns equals the preview's.
 *
 * Rollback relies on `MemoryStore.transaction` dropping the writes when its
 * callback throws (memory-store.ts, `transaction`), which the core's
 * PreviewRollback does as its last step. A figure that waits on `store.begin`
 * from inside a preview is stopped by the store's nested-call guard rather
 * than left waiting.
 */
import {
	type Actor,
	createPreviewRunnerCore,
	type MoneyMutation,
	type PreviewRunner,
} from "@retrospend/domain/figures/preview";
import type {
	FigureNarrowing,
	FiguresRegistry,
} from "@retrospend/domain/figures/registry";
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import { recordWrite, type WriteFn } from "./local-db";
import type { Reader, Store, Tx } from "./port";
import { applyUndo, type UndoToken } from "./undo";

/** A device money mutation: runs on a store transaction and returns an engine undo token. */
export type DeviceMutation<Input, Value> = MoneyMutation<
	Input,
	Value,
	Tx,
	UndoToken
>;

export type DevicePreviewRunner = PreviewRunner<Tx, UndoToken>;

/**
 * A mutation from a write function (the same one LocalDb.write takes), so the
 * preview and the write are one piece of code. `touches` are the figure ids
 * the write can change.
 */
export function deviceMutation<Input, Value>(def: {
	readonly id: string;
	readonly touches: readonly string[];
	readonly scope?: (input: Input) => FigureNarrowing;
	readonly write: (input: Input) => WriteFn<Value>;
}): DeviceMutation<Input, Value> {
	return {
		id: def.id,
		touches: def.touches,
		scope: def.scope,
		run: (tx, input) => recordWrite(tx, def.id, def.write(input)),
	};
}

/**
 * Undo as a mutation, so the Undo sheet can preview it like any other write.
 * `touches` are the original mutation's: the undo moves the same figures back.
 * Its token undoes the undo (redo), as LocalDb.undo's does.
 */
export function deviceUndoMutation(
	token: UndoToken,
	touches: readonly string[],
): DeviceMutation<void, void> {
	return {
		id: `${token.mutation}.undo`,
		touches,
		run: async (tx) => ({ value: undefined, undo: applyUndo(tx, token) }),
	};
}

/** expense.create on the device; touches what the server's mutation does (expense-create.mutation.ts). */
export const EXPENSE_CREATE_MUTATION = deviceMutation({
	id: EXPENSE_CREATE,
	touches: ["spent", "glance.spent"],
	write: createExpense,
});

/**
 * The device's runner over `store`. The store's transactions are already the
 * user's own rows, so there is no isolation level to pick, and a device has
 * no preview-only state to mark (the server marks a preview so sealing makes
 * no key there), so the mark is the identity.
 */
export function createDevicePreviewRunner(deps: {
	readonly store: Store;
	readonly figures: FiguresRegistry<Reader>;
	readonly actor: Actor;
}): DevicePreviewRunner {
	return createPreviewRunnerCore<Tx, UndoToken>({
		figures: deps.figures,
		actor: deps.actor,
		transaction: (work) => deps.store.transaction(work),
		markPreview: (work) => work(),
	});
}
