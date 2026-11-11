/**
 * Money previews (R30, IMPLEMENTATION §2.4): every money action shows, before
 * saving, exactly what it will change and what it will not. The preview is a
 * dry run of the real mutation inside a transaction that always rolls back,
 * so preview = result by construction.
 *
 * How a mutation registers:
 *
 * 1. Write it as a `MoneyMutation` in a `*.mutation.ts` file under
 *    `src/server/services` (for example `services/payments/record.mutation.ts`):
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
 *    `run` does every read and write through `tx`. The global `db`, or any
 *    service built on it (audit `logEvent`, a service that opens its own
 *    `$transaction`), uses another connection that commits even during a
 *    preview. Biome bans importing `~/server/db` in `*.mutation.ts` files and
 *    in `src/server/services/figures/**` (biome.jsonc overrides); helpers they
 *    call must take `tx` too. Side effects outside the database (emails,
 *    push) go after `apply` resolves, since a preview cannot undo them.
 * 2. Every id in `touches` must be registered in `src/server/figures/registry.ts`;
 *    an unknown id fails before any transaction opens. Figures marked
 *    `inEveryPreview` (accounts, net worth) are checked on top, which is what
 *    lets a sheet say "Your accounts and net worth: no change".
 * 3. Expose the pair from the transport, both calling the same object:
 *      forUser(ctx.userId).preview(recordPayment, input)   // `.../preview`
 *      forUser(ctx.userId).apply(recordPayment, input)     // the write
 *    Both return `{ value, changes[], unchanged[], unavailable[] }`; apply adds
 *    the `undo` token. Changes are per currency and never converted.
 *
 * A preview runs at REPEATABLE READ so its before and after snapshots see one
 * consistent view of other users' writes; apply runs at READ COMMITTED like
 * every other write.
 */
import { db } from "~/server/db";
import { type UserTransactionOptions, userTransaction } from "~/server/db-tx";
import { type FigureDb, figures } from "~/server/figures/registry";
import { notifyEventsCommitted } from "~/server/services/events/notify";
import { recordMutationEvent } from "~/server/services/events/scope";
import { Prisma } from "~prisma";
import { createPreviewRunner, type PreviewRunner } from "./runner";
import type { TransactionPurpose, TransactionRunner } from "./types";

/** A preview reads every figure twice, so it gets more than Prisma's 5s default. */
const TRANSACTION_OPTIONS: Record<TransactionPurpose, UserTransactionOptions> =
	{
		preview: {
			isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
			timeout: 15_000,
		},
		apply: { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
	};

/** The RLS transaction a preview or apply runs in for `userId`. Exported so pg tests use the real one. */
export function userTransactionRunner(
	userId: string,
): TransactionRunner<FigureDb> {
	return (work, purpose) =>
		userTransaction(db, userId, work, TRANSACTION_OPTIONS[purpose]);
}

export function forUser(userId: string): PreviewRunner<FigureDb> {
	return createPreviewRunner({
		figures,
		actor: { userId },
		transaction: userTransactionRunner(userId),
		// Every applied mutation appends its event in its own transaction (the outbox).
		onApplied: recordMutationEvent,
		afterCommit: notifyEventsCommitted,
	});
}

export type { PreviewRunner } from "./runner";
export type * from "./types";
