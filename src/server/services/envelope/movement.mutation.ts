/**
 * The movement writes as money mutations (R30, D28): assign, move, cover and
 * undo. Each previews as the same write rolled back. Undo tokens point at the
 * rows the write appended; `envelope.undo` mirrors them.
 */
import type {
	AssignInput,
	CoverInput,
	MoveInput,
	MovementResult,
	UndoInput,
} from "~/lib/schemas/envelope";
import type { MoneyMutation, UndoToken } from "../preview/types";
import { assign, cover, move, undo } from "./movement.service";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

const TOUCHES = [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND, "envelope.left"];

function undoToken(mutation: string, value: MovementResult): UndoToken {
	const rows = value.movements.map((m) => ({
		table: "budget_movement",
		id: m.id,
	}));
	return rows.length === 1 && rows[0]
		? { kind: "mirror", mutation, movement: rows[0] }
		: { kind: "revert", mutation, rows };
}

export const assignEnvelopes: MoneyMutation<AssignInput, MovementResult> = {
	id: "envelope.assign",
	touches: TOUCHES,
	scope: (input) =>
		input.items[0] ? { envelopeId: input.items[0].envelopeId } : {},
	run: async (tx, input, actor) => {
		const value = await assign(tx, actor.userId, input, new Date());
		return { value, undo: undoToken("envelope.assign", value) };
	},
};

export const moveMoney: MoneyMutation<MoveInput, MovementResult> = {
	id: "envelope.move",
	touches: TOUCHES,
	scope: (input) => {
		const envelopeId = input.to ?? input.from;
		return envelopeId ? { envelopeId } : {};
	},
	run: async (tx, input, actor) => {
		const value = await move(tx, actor.userId, input, new Date());
		return { value, undo: undoToken("envelope.move", value) };
	},
};

export const coverEnvelope: MoneyMutation<CoverInput, MovementResult> = {
	id: "envelope.cover",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.envelopeId }),
	run: async (tx, input, actor) => {
		const value = await cover(tx, actor.userId, input, new Date());
		return { value, undo: undoToken("envelope.cover", value) };
	},
};

export const undoMovements: MoneyMutation<UndoInput, MovementResult> = {
	id: "envelope.undo",
	touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx, input, actor) => {
		const value = await undo(tx, actor.userId, input, new Date());
		return { value, undo: undoToken("envelope.undo", value) };
	},
};
