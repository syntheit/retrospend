/**
 * A group's target (SPEC §5.9): none, a fixed amount, or a percent of money
 * in, with the envelope that takes what the children's own targets leave.
 * Setting it moves no money: it changes what the group needs, which Use my
 * plan and the group header read. The result carries the previous target,
 * so an undo is the same call with it.
 */
import type { GroupTargetInput } from "~/lib/schemas/envelope";
import type {
	GroupTargetResult,
	SetGroupTargetInput,
} from "~/lib/schemas/envelope-plan";
import type { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { groupTargetOf } from "./group-view";
import { forgetMonthViews } from "./month-read";
import { requireBook } from "./rule.service";
import { groupTargetColumns } from "./setup-p5";

type Tx = Prisma.TransactionClient;

function asInput(
	g: Parameters<typeof groupTargetOf>[0],
	H: string,
): GroupTargetInput {
	const { target } = groupTargetOf(g, H);
	if (!target) return { kind: "NONE" };
	return target.kind === "AMOUNT"
		? { kind: "AMOUNT", amountMinor: target.value }
		: target.kind === "PERCENT_OF_INCOME"
			? { kind: "PERCENT_OF_INCOME", basisPoints: target.value }
			: { kind: "NONE" };
}

export async function setGroupTarget(
	tx: Tx,
	userId: string,
	input: SetGroupTargetInput,
): Promise<GroupTargetResult> {
	const book = await requireBook(tx, userId);
	const group = book.groups.find((g) => g.id === input.groupId);
	if (!group) throw new EnvelopeError("NOT_FOUND", "no such group");
	const main =
		input.mainEnvelopeId === undefined
			? group.mainEnvelopeId
			: input.mainEnvelopeId;
	if (
		main &&
		!book.envelopes.some(
			(e) => e.id === main && e.groupId === group.id && e.archivedAt === null,
		)
	)
		throw new EnvelopeError(
			"INVALID",
			"the main envelope belongs to the group",
		);
	const previous = {
		target: asInput(group, book.currency),
		mainEnvelopeId: group.mainEnvelopeId,
	};
	await tx.envelopeGroup.update({
		where: { id: group.id },
		data: {
			...groupTargetColumns(input.target, book.currency),
			mainEnvelopeId: main,
		},
	});
	forgetMonthViews(tx);
	return {
		groupId: group.id,
		target: input.target,
		mainEnvelopeId: main,
		previous,
	};
}
