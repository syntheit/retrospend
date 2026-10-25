import type { PreviewResult as PreviewDto } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Caller } from "./caller";
import { type GuardRef, guardedUndo, readStamp } from "./guard";
import { spendUndo, toPreviewDto } from "./money-write";
import { staleAsConflict } from "./stale";
import { mintUndo, readUndo, type UndoFamily } from "./undo";
import { type Wire, wire } from "./wire";

/**
 * The write/preview/undo trio of the budget and account routes. A group
 * names its inverse calls (`Op`), registers each as a mutation, and gets:
 * - `moneyOp(mutation, { plan })`: `write` applies the web's own mutation and
 *   mints a signed single-use undo token from `plan`; `preview` runs the same
 *   mutation rolled back and answers its figures diff with `detail.result`,
 *   the answer the write would give (payments do the same);
 * - `undoer(registry)`: apply or preview an undo token.
 */

export type LedgerCaller = Caller & { timeZone: string };

/** What taking a write back needs: the inverse's input and the row it must still find unchanged. */
export type UndoPlan<Op extends string> = {
	op: Op;
	args: unknown;
	guard?: GuardRef;
};

/** The payload inside an undo token (signed by undo.ts). */
export type TokenInput = {
	args: unknown;
	guard: GuardRef | null;
	stamp: string | null;
};

type Stamped<V, Op extends string> = {
	value: V;
	plan: UndoPlan<Op> | null;
	stamp: string | null;
};

export type PreviewWithDetail<V> = PreviewDto & {
	detail: { kind: string; result: Wire<V> };
};

export type MoneyOp<I, V, C extends LedgerCaller = LedgerCaller> = {
	write(caller: C, input: I): Promise<{ result: Wire<V>; undo: string | null }>;
	preview(caller: C, input: I): Promise<PreviewWithDetail<V>>;
};

type OpConfig<I, MI, V, R, Op extends string, C> = {
	/** The contract input as the mutation takes it (setup adds the time zone). */
	prep?: (caller: C, input: I) => MI;
	/** The part of the mutation's value the route answers with; the rest only feeds the undo plan. */
	present?: (value: V) => R;
	/** How to take the write back; no plan, no token. */
	plan?: (input: MI, value: V) => UndoPlan<Op> | null;
};

/** The mutation plus, in the same transaction, the stamp its undo will check. */
function stamped<I, V, Op extends string>(
	mutation: MoneyMutation<I, V>,
	plan: (input: I, value: V) => UndoPlan<Op> | null,
): MoneyMutation<I, Stamped<V, Op>> {
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

export function createMoneyOp<Op extends string, C extends LedgerCaller>(
	family: UndoFamily,
) {
	return function moneyOp<I, V, MI = I, R = V>(
		mutation: MoneyMutation<MI, V>,
		config: OpConfig<I, MI, V, R, Op, C> = {},
	): MoneyOp<I, R, C> {
		const prep = config.prep ?? ((_c: C, input: I) => input as unknown as MI);
		const present = config.present ?? ((value: V) => value as unknown as R);
		const run = stamped(mutation, config.plan ?? (() => null));
		return {
			async write(caller, input) {
				const userId = caller.principal.userId;
				const { value } = await forUser(userId).apply(run, prep(caller, input));
				const token = value.plan
					? mintUndo(userId, family, value.plan.op, {
							args: value.plan.args,
							guard: value.plan.guard ?? null,
							stamp: value.stamp,
						} satisfies TokenInput)
					: null;
				return { result: wire(present(value.value)), undo: token };
			},
			async preview(caller, input) {
				const preview = await forUser(caller.principal.userId).preview(
					mutation,
					prep(caller, input),
				);
				return {
					...toPreviewDto(preview),
					detail: { kind: mutation.id, result: wire(present(preview.value)) },
				};
			},
		};
	};
}

// biome-ignore lint/suspicious/noExplicitAny: each inverse has its own input and answer
export type AnyMutation = MoneyMutation<any, any>;

const invalid = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

/**
 * Apply or preview an undo token against a registry of inverses. A token that
 * can no longer apply is a conflict (409): either it was used, or the row it
 * guards changed, or the engine refuses (see stale.ts).
 */
export function createUndoer<Op extends string, C extends LedgerCaller>(
	family: UndoFamily,
	inverses: Record<Op, AnyMutation>,
) {
	function open(caller: C, token: string) {
		const { op, input } = readUndo(caller.principal.userId, family, token);
		const mutation = inverses[op as Op];
		if (!mutation) throw invalid();
		const { args, guard, stamp } = input as TokenInput;
		return {
			kind: op as Op,
			args,
			mutation: guardedUndo(mutation, guard, stamp),
		};
	}
	return {
		undo(caller: C, token: string) {
			const { kind, args, mutation } = open(caller, token);
			return spendUndo(caller, token, () =>
				staleAsConflict(async () => {
					const { value } = await forUser(caller.principal.userId).apply(
						mutation,
						args,
					);
					return { result: { kind, result: wire(value) }, redo: null };
				}),
			);
		},
		async preview(caller: C, token: string) {
			const { kind, args, mutation } = open(caller, token);
			const preview = await staleAsConflict(() =>
				forUser(caller.principal.userId).preview(mutation, args),
			);
			return {
				...toPreviewDto(preview),
				detail: { kind, result: wire(preview.value) },
			};
		},
	};
}
