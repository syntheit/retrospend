/**
 * envelope.undoSetup as a money mutation (R30): takes a started budget back.
 * The preview is the same delete rolled back, so the sheet can say the budget
 * and its starting balance go and nothing else does. It refuses once the
 * budget holds work of its own (setup-undo.service.ts).
 */
import type { MoneyMutation } from "../preview/types";
import {
	type UndoSetupInput,
	type UndoSetupResult,
	undoSetup,
} from "./setup-undo.service";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

export const undoSetupEnvelopeBook: MoneyMutation<
	UndoSetupInput,
	UndoSetupResult
> = {
	id: "envelope.undoSetup",
	touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx, input, actor) => ({
		value: await undoSetup(tx, actor.userId, input),
		// An undo is not undone: start the budget again from the sheet.
		undo: { kind: "revert", mutation: "envelope.setup", rows: [] },
	}),
};
