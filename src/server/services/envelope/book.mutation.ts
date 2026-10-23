/**
 * The P4 book writes as money mutations (R30, R15): each previews as the same
 * write rolled back and returns its undo. Limits deltas, style switches,
 * Welcome back, reconcile and book periods all change what the budget shows,
 * so none is written without a preview.
 */
import type { MovementResult } from "~/lib/schemas/envelope";
import type {
	Adjustment,
	BookPeriodResult,
	ReconcileInput,
	RemoveAdjustmentInput,
	RevertStyleInput,
	RevertStyleResult,
	SetBookPeriodInput,
	SetLimitInput,
	SetLimitResult,
	SetStyleInput,
	SetStyleResult,
	WelcomeBackInput,
	WelcomeBackResult,
} from "~/lib/schemas/envelope-book";
import type { MoneyMutation, UndoToken } from "../preview/types";
import { removeAdjustment } from "./adjustment";
import { FIGURE_BUDGET_HOLDS } from "./figures";
import { setLimit } from "./limits.service";
import { setBookPeriod } from "./period.service";
import { revertStyle, setStyle } from "./style.service";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";
import { reconcile, welcomeBack } from "./welcome.service";

const POOL = [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND, FIGURE_LEFT_IN_LIMITS];

function movementUndo(value: MovementResult): UndoToken {
	const rows = value.movements.map((m) => ({
		table: "budget_movement",
		id: m.id,
	}));
	return rows.length === 1 && rows[0]
		? { kind: "mirror", mutation: "envelope.undo", movement: rows[0] }
		: { kind: "revert", mutation: "envelope.undo", rows };
}

function adjustmentUndo(a: Adjustment | null, of: string): UndoToken {
	return {
		kind: "revert",
		mutation: a?.expenseId ? "envelope.removeAdjustment" : of,
		rows: a?.expenseId ? [{ table: "expense", id: a.expenseId }] : [],
	};
}

export const setLimitMutation: MoneyMutation<SetLimitInput, SetLimitResult> = {
	id: "envelope.setLimit",
	touches: [...POOL, "envelope.left"],
	scope: (input) => ({ envelopeId: input.envelopeId }),
	run: async (tx, input, actor) => {
		const value = await setLimit(tx, actor.userId, input, new Date());
		// "From now on" stored a new target too: undo sets the old limit again.
		const undo: UndoToken =
			input.scope === "FROM_NOW_ON"
				? {
						kind: "revert",
						mutation: "envelope.setLimit",
						rows: [
							{ table: "envelope", id: value.envelopeId },
							...value.movements.map((m) => ({
								table: "budget_movement",
								id: m.id,
							})),
						],
					}
				: movementUndo(value);
		return { value, undo };
	},
};

export const setStyleMutation: MoneyMutation<SetStyleInput, SetStyleResult> = {
	id: "envelope.setStyle",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await setStyle(tx, actor.userId, input, new Date());
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.revertStyle",
				rows: [
					{ table: "budget_book", id: value.bookId },
					...(value.adjustment
						? [{ table: "expense", id: value.adjustment.id }]
						: []),
				],
			},
		};
	},
};

export const revertStyleMutation: MoneyMutation<
	RevertStyleInput,
	RevertStyleResult
> = {
	id: "envelope.revertStyle",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await revertStyle(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.setStyle",
				rows: [{ table: "budget_book", id: value.bookId }],
			},
		};
	},
};

export const reconcileMutation: MoneyMutation<ReconcileInput, Adjustment> = {
	id: "envelope.reconcile",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await reconcile(tx, actor.userId, input, new Date());
		return { value, undo: adjustmentUndo(value, "envelope.reconcile") };
	},
};

export const removeAdjustmentMutation: MoneyMutation<
	RemoveAdjustmentInput,
	Adjustment
> = {
	id: "envelope.removeAdjustment",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await removeAdjustment(tx, actor.userId, input.expenseId);
		// Removing it is undone by recording the same amount again.
		return {
			value,
			undo: { kind: "revert", mutation: "envelope.reconcile", rows: [] },
		};
	},
};

export const welcomeBackMutation: MoneyMutation<
	WelcomeBackInput,
	WelcomeBackResult
> = {
	id: "envelope.welcomeBack",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await welcomeBack(tx, actor.userId, input, new Date());
		const undo = value.movements
			? movementUndo(value.movements)
			: adjustmentUndo(value.adjustment, "envelope.welcomeBack");
		return { value, undo };
	},
};

export const setBookPeriodMutation: MoneyMutation<
	SetBookPeriodInput,
	BookPeriodResult
> = {
	id: "envelope.setBookPeriod",
	touches: POOL,
	run: async (tx, input, actor) => {
		const value = await setBookPeriod(tx, actor.userId, input, new Date());
		// Setting the previous values again removes the pending period.
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.setBookPeriod",
				rows: value.periodId ? [{ table: "book_period", id: value.periodId }] : [],
			},
		};
	},
};
