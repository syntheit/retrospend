import type { PreviewResult as PreviewDto } from "@retrospend/api-contract";
import { dec, toMinor } from "~/server/services/envelope/units";
import { forUser } from "~/server/services/preview";
import type {
	MoneyMutation,
	PreviewResult,
} from "~/server/services/preview/types";
import type { Caller } from "./caller";
import { mintUndo, type UndoFamily } from "./undo";

/**
 * The preview/apply pair of every v1 money write (R30): both run the same
 * MoneyMutation the web runs, one inside a transaction that rolls back.
 */

/** The wire form of a preview: figures that moved, did not move, or could not be read. */
export function toPreviewDto(result: PreviewResult<unknown>): PreviewDto {
	return {
		changes: result.changes.map((c) => ({
			id: c.id,
			currency: c.currency,
			before: c.before,
			after: c.after,
			delta: c.delta,
			figureAfter: [...c.figureAfter],
		})),
		unchanged: result.unchanged.map((u) => ({ id: u.id, lines: [...u.value] })),
		unavailable: result.unavailable.map((u) => ({
			id: u.id,
			before: u.before ? [...u.before] : null,
			after: u.after ? [...u.after] : null,
		})),
	};
}

export async function previewWrite<I, V>(
	caller: Caller,
	mutation: MoneyMutation<I, V>,
	input: I,
): Promise<PreviewDto> {
	return toPreviewDto(
		await forUser(caller.principal.userId).preview(mutation, input),
	);
}

export async function applyWrite<I, V>(
	caller: Caller,
	mutation: MoneyMutation<I, V>,
	input: I,
): Promise<V> {
	return (await forUser(caller.principal.userId).apply(mutation, input)).value;
}

/** An undo token for the inverse call `op` with `input`. */
export function undoFor(
	caller: Caller,
	family: UndoFamily,
	op: string,
	input: unknown,
): string {
	return mintUndo(caller.principal.userId, family, op, input);
}

/** A stored decimal balance as Money in its own currency. */
export function moneyOfText(amount: string, currency: string) {
	return { minor: toMinor(dec(amount), currency), currency };
}

/** An account's balance before and after, with the strings as Money. */
export function accountChangeDto(a: {
	accountId: string;
	name: string;
	currency: string;
	before: string;
	after: string;
}) {
	return {
		accountId: a.accountId,
		name: a.name,
		before: moneyOfText(a.before, a.currency),
		after: moneyOfText(a.after, a.currency),
	};
}
