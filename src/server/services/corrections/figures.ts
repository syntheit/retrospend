/**
 * The correction figures (IMPLEMENTATION §2.4): what the corrections of one
 * shared expense changed for one person. A correction holds only the
 * difference from what the split was (the original is never rewritten), so
 * these are sums over its correction rows, per currency in minor units:
 * - `correction.paid`: what the person paid more (less when negative).
 * - `correction.share`: how far the person's share moved.
 * Narrowed by `transactionId` (the corrected expense) and `personId`
 * (`<participantType>:<participantId>`). Empty when nothing corrected the
 * expense. A reader sees the correction rows RLS shows them: everything for
 * the person who made the corrections, their own share for anyone else.
 */
import type {
	FigureDb,
	FigureDefinition,
	FigureScope,
	Money,
} from "~/server/figures/registry";
import { sumMinor, toMinor } from "~/server/services/envelope/units";
import { parsePersonKey } from "~/server/services/payments/view";

type Part = "paid" | "share";

async function changed(
	db: FigureDb,
	scope: FigureScope,
	part: Part,
): Promise<Money[]> {
	const id = `correction.${part}`;
	if (!scope.transactionId || !scope.personId)
		throw new Error(`${id} needs transactionId and personId narrowings`);
	const person = parsePersonKey(scope.personId);
	if (!person) throw new Error(`${id} needs a personId like "user:<id>"`);
	const rows = await db.sharedTransaction.findMany({
		where: { correctsId: scope.transactionId },
		select: {
			currency: true,
			amount: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
				},
			},
		},
	});
	const parts = new Map<string, number[]>();
	for (const row of rows) {
		const list = parts.get(row.currency) ?? [];
		parts.set(row.currency, list);
		if (part === "paid") {
			if (
				row.paidByType === person.participantType &&
				row.paidById === person.participantId
			)
				list.push(toMinor(row.amount.toString(), row.currency));
			continue;
		}
		for (const sp of row.splitParticipants)
			if (
				sp.participantType === person.participantType &&
				sp.participantId === person.participantId
			)
				list.push(toMinor(sp.shareAmount.toString(), row.currency));
	}
	return [...parts].map(([currency, list]) => ({
		minor: sumMinor(list),
		currency,
	}));
}

const correctionFigure = (part: Part): FigureDefinition => ({
	id: `correction.${part}`,
	scope: ["transactionId", "personId"],
	compute: (db, scope) => changed(db, scope, part),
});

export const correctionFigures: readonly FigureDefinition[] = [
	correctionFigure("paid"),
	correctionFigure("share"),
];
