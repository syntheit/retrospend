import type { Categorized } from "@retrospend/domain/expense-write/bulk";

type Say = (
	key: "moved" | "movedSome",
	values: { count: number; name: string; left?: number },
) => string;

/**
 * The toast after a bulk categorize, worded from what the server answered:
 * the rows it moved, and the ones it left alone (a spread parent, a
 * transfer's fee). The count the person picked never appears here.
 */
export function movedMessage(
	say: Say,
	done: Pick<Categorized, "updated" | "skipped">,
	name: string,
) {
	return done.skipped.length
		? say("movedSome", {
				count: done.updated,
				left: done.skipped.length,
				name,
			})
		: say("moved", { count: done.updated, name });
}
