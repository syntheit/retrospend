/**
 * Money previews (R30, IMPLEMENTATION §2.4): every money action shows, before
 * saving, exactly what it will change and what it will not. The preview is a
 * dry run of the real mutation inside a transaction that always rolls back,
 * so preview = result by construction.
 *
 * How a mutation registers:
 *
 * 1. Write it as a `MoneyMutation` in its own service (for example
 *    `services/payments/record.ts`):
 *
 *      export const recordPayment: MoneyMutation<RecordPaymentInput, Payment> = {
 *        id: "payment.record",
 *        touches: ["owed.owedToYou", "owed.youOwe", "balance.withPerson"],
 *        scope: (input) => ({ personId: input.personId }),
 *        run: async (tx, input, actor) => {
 *          const payment = await writePayment(tx, input, actor.userId);
 *          return { value: payment, undo: { kind: "revert", mutation: "payment.record", rows: [{ table: "payment", id: payment.id }] } };
 *        },
 *      };
 *
 *    `run` does every read and write through `tx`. Side effects outside the
 *    database (emails, push) go after `apply` resolves, since a preview cannot
 *    undo them.
 * 2. Every id in `touches` must be registered in `src/server/figures/registry.ts`;
 *    an unknown id fails before any transaction opens. Figures marked
 *    `inEveryPreview` (accounts, net worth) are checked on top, which is what
 *    lets a sheet say "Your accounts and net worth: no change".
 * 3. Expose the pair from the transport, both calling the same object:
 *      forUser(ctx.userId).preview(recordPayment, input)   // `.../preview`
 *      forUser(ctx.userId).apply(recordPayment, input)     // the write
 *    Both return `{ value, changes[], unchanged[] }`; apply adds the `undo` token.
 */
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { type FigureDb, figures } from "~/server/figures/registry";
import { createPreviewRunner, type PreviewRunner } from "./runner";

export function forUser(userId: string): PreviewRunner<FigureDb> {
	return createPreviewRunner({
		figures,
		actor: { userId },
		transaction: (work) => userTransaction(db, userId, work),
	});
}

export type { PreviewRunner } from "./runner";
export type * from "./types";
