/**
 * The close-time writes as money mutations (R30, R15): each previews as the
 * same write rolled back; undo is envelope.undo of the rows it appended.
 */
import type {
	BatchInput,
	CarryOverspendInput,
	MovementResult,
} from "~/lib/schemas/envelope";
import type { MoneyMutation, UndoToken } from "../preview/types";
import { carryOverspend, fixNegative, resetEnvelopes } from "./fix.service";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

const TOUCHES = [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND, "envelope.left"];

function undoToken(value: MovementResult): UndoToken {
	const rows = value.movements.map((m) => ({
		table: "budget_movement",
		id: m.id,
	}));
	return rows.length === 1 && rows[0]
		? { kind: "mirror", mutation: "envelope.undo", movement: rows[0] }
		: { kind: "revert", mutation: "envelope.undo", rows };
}

export const carryOverspendMutation: MoneyMutation<
	CarryOverspendInput,
	MovementResult
> = {
	id: "envelope.carryOverspend",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.envelopeId }),
	run: async (tx, input, actor) => {
		const value = await carryOverspend(tx, actor.userId, input, new Date());
		return { value, undo: undoToken(value) };
	},
};

export const fixNegativeMutation: MoneyMutation<BatchInput, MovementResult> = {
	id: "envelope.fixNegative",
	touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx, input, actor) => {
		const value = await fixNegative(tx, actor.userId, input, new Date());
		return { value, undo: undoToken(value) };
	},
};

export const resetEnvelopesMutation: MoneyMutation<BatchInput, MovementResult> =
	{
		id: "envelope.reset",
		touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
		run: async (tx, input, actor) => {
			const value = await resetEnvelopes(tx, actor.userId, input, new Date());
			return { value, undo: undoToken(value) };
		},
	};
