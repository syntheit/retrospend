/**
 * The splits writes as money mutations (R30, R15): each previews as the
 * same write rolled back, and each returns what its undo needs.
 *
 * - envelope.setShareCategory: undo sets the previous category back.
 * - envelope.setProjectRouting: undo sets the previous routing back.
 * - envelope.forgive: undo is envelope.unforgive of the payment it wrote.
 * - envelope.unforgive: undo is envelope.forgive with the same input.
 */
import type {
	ForgiveInput,
	ForgiveResult,
	ProjectRoutingResult,
	SetProjectRoutingInput,
	SetShareCategoryInput,
	ShareCategoryResult,
	UnforgiveInput,
} from "~/lib/schemas/envelope";
import type { MoneyMutation } from "../preview/types";
import { FIGURE_HELD_FOR_OTHERS } from "./figures";
import {
	forgive,
	forgivenValue,
	setProjectRouting,
	setShareCategory,
	unforgive,
} from "./splits.service";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

const BUDGET = [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND];
const OWED = [...BUDGET, FIGURE_HELD_FOR_OTHERS, "owed.owedToYou"];

export const setShareCategoryMutation: MoneyMutation<
	SetShareCategoryInput,
	ShareCategoryResult
> = {
	id: "envelope.setShareCategory",
	touches: BUDGET,
	run: async (tx, input, actor) => {
		const value = await setShareCategory(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.setShareCategory",
				rows: [{ table: "split_participant", id: value.shareId }],
			},
		};
	},
};

export const setProjectRoutingMutation: MoneyMutation<
	SetProjectRoutingInput,
	ProjectRoutingResult
> = {
	id: "envelope.setProjectRouting",
	touches: [...BUDGET, FIGURE_HELD_FOR_OTHERS],
	scope: (input) => ({ projectId: input.projectId }),
	run: async (tx, input, actor) => {
		const value = await setProjectRouting(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.setProjectRouting",
				rows: [{ table: "project_participant", id: value.participantId }],
			},
		};
	},
};

export const forgiveMutation: MoneyMutation<ForgiveInput, ForgiveResult> = {
	id: "envelope.forgive",
	touches: [...OWED, "balance.person", "envelope.left"],
	scope: (input) => ({
		personId: `${input.participant.type}:${input.participant.id}`,
		...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
	}),
	run: async (tx, input, actor) => {
		const now = new Date();
		const ids = await forgive(tx, actor.userId, input, now);
		return {
			value: {
				paymentId: input.id,
				amount: { minor: input.amountMinor, currency: input.currency },
				charged: await forgivenValue(tx, actor.userId, ids, now),
				envelopeId: input.envelopeId,
			},
			undo: {
				kind: "revert",
				mutation: "envelope.unforgive",
				rows: [{ table: "payment", id: input.id }],
			},
		};
	},
};

export const unforgiveMutation: MoneyMutation<
	UnforgiveInput,
	{ paymentId: string }
> = {
	id: "envelope.unforgive",
	touches: OWED,
	run: async (tx, input, actor) => {
		const value = await unforgive(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.forgive",
				rows: [{ table: "payment", id: value.paymentId }],
			},
		};
	},
};
