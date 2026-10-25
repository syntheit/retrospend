import type { PreviewResult as PreviewDto } from "@retrospend/api-contract";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { toPreviewDto } from "../money-write";
import { mintUndo } from "../undo";
import { type GuardRef, readStamp } from "./guard";
import type { BudgetCaller } from "./serve";
import { type Wire, wire } from "./wire";

/** The inverse calls an undo token can name (the `kind` of the undo answer). */
export type UndoOp =
	| "movement.undo"
	| "change.undo"
	| "limit.revert"
	| "style.revert"
	| "adjustment.remove"
	| "share_category.set"
	| "project_routing.set"
	| "forgive.undo"
	| "period.set"
	| "draft.unapply"
	| "hidden_rows.revert"
	| "debt_payment.delete";

/** What taking a write back needs: the inverse's input and the row it must still find unchanged. */
export type UndoPlan = {
	op: UndoOp;
	args: unknown;
	guard?: GuardRef;
};

/** The payload inside a budget undo token (signed by api-v1/undo.ts). */
export type TokenInput = {
	args: unknown;
	guard: GuardRef | null;
	stamp: string | null;
};

type Stamped<V> = { value: V; plan: UndoPlan | null; stamp: string | null };

/** The mutation plus, in the same transaction, the stamp its undo will check. */
function stamped<I, V>(
	mutation: MoneyMutation<I, V>,
	plan: (input: I, value: V) => UndoPlan | null,
): MoneyMutation<I, Stamped<V>> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const done = await mutation.run(tx, input, actor);
			const p = plan(input, done.value);
			const stamp = p?.guard
				? await readStamp(tx, actor.userId, p.guard)
				: null;
			return { value: { value: done.value, plan: p, stamp }, undo: done.undo };
		},
	};
}

export type PreviewWithDetail<V> = PreviewDto & {
	detail: { kind: string; result: Wire<V> };
};

export type MoneyOp<I, V> = {
	write(
		caller: BudgetCaller,
		input: I,
	): Promise<{ result: Wire<V>; undo: string | null }>;
	preview(caller: BudgetCaller, input: I): Promise<PreviewWithDetail<V>>;
};

type OpConfig<I, MI, V> = {
	/** The contract input as the mutation takes it (setup adds the time zone). */
	prep?: (caller: BudgetCaller, input: I) => MI;
	/** How to take the write back; no plan, no token. */
	plan?: (input: MI, value: V) => UndoPlan | null;
};

/**
 * A budget money write as the pair every v1 route needs: `write` applies the
 * web's own mutation and mints the undo token; `preview` runs the same
 * mutation rolled back and returns its figures diff with `detail.result`,
 * the answer the write would give.
 */
export function moneyOp<I, V, MI = I>(
	mutation: MoneyMutation<MI, V>,
	config: OpConfig<I, MI, V> = {},
): MoneyOp<I, V> {
	const prep =
		config.prep ?? ((_c: BudgetCaller, input: I) => input as unknown as MI);
	const plan = config.plan ?? (() => null);
	const run = stamped(mutation, plan);
	return {
		async write(caller, input) {
			const userId = caller.principal.userId;
			const { value } = await forUser(userId).apply(run, prep(caller, input));
			const token = value.plan
				? mintUndo(userId, "budget", value.plan.op, {
						args: value.plan.args,
						guard: value.plan.guard ?? null,
						stamp: value.stamp,
					} satisfies TokenInput)
				: null;
			return { result: wire(value.value), undo: token };
		},
		async preview(caller, input) {
			const preview = await forUser(caller.principal.userId).preview(
				mutation,
				prep(caller, input),
			);
			return {
				...toPreviewDto(preview),
				detail: { kind: mutation.id, result: wire(preview.value) },
			};
		},
	};
}
