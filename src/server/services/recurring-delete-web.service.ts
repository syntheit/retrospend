/**
 * The web's delete of a recurring template and its Undo (R30): the same
 * mutations /api/v1 runs (recurring-delete.mutation.ts), so the preview, the
 * delete and the restore have one owner. This adds only the token. The
 * snapshot the delete returns is signed into a restore token (restore-token.ts,
 * 24 hours, this user only), so the toast carries it back and the client never
 * writes the template it restores.
 *
 * What the restore refuses is the mutation's own: a template with that id is
 * back already, or one like it was made by hand since.
 */

import { spendSignature } from "~/server/services/api-v1/money-write";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import {
	type RestoreToken,
	readRestore,
	signRestore,
} from "./entry/restore-token";
import {
	type DeleteRecurringInput,
	deleteRecurringFor,
	type RestoreRecurringInput,
	restoreRecurringFor,
	type TemplateSnapshot,
} from "./recurring-delete.mutation";

/** The kind of signed token a web delete returns for its Undo. */
export const RECURRING_DELETE = "recurring.delete";

export interface RemovedRecurring {
	readonly id: string;
	/** `restore` with this token brings the template back as it was. */
	readonly restore: RestoreToken;
	/** BILL envelopes that followed it; their targets are cleared. */
	readonly envelopeTargets: number;
}

/** The delete, answering with the Undo token in place of the snapshot. */
function signed(
	inner: MoneyMutation<DeleteRecurringInput, TemplateSnapshot>,
): MoneyMutation<DeleteRecurringInput, RemovedRecurring> {
	return {
		...inner,
		run: async (tx, input, actor) => {
			const done = await inner.run(tx, input, actor);
			return {
				...done,
				value: {
					id: done.value.id,
					restore: signRestore(RECURRING_DELETE, actor.userId, done.value),
					envelopeTargets: done.value.envelopeIds.length,
				},
			};
		},
	};
}

type Db = Pick<Prisma.TransactionClient, "envelope">;

/** What deleting would change and not change; writes nothing. */
export async function previewDeleteTemplate(
	db: Db,
	userId: string,
	templateId: string,
) {
	const remove = signed(await deleteRecurringFor(db, userId, templateId));
	const { value, ...preview } = await forUser(userId).preview(remove, {
		templateId,
	});
	// Whether a BILL envelope's target goes with it, for the sheet's own line.
	return { ...preview, envelopeTargets: value.envelopeTargets };
}

export async function deleteTemplate(
	db: Db,
	userId: string,
	templateId: string,
) {
	const remove = signed(await deleteRecurringFor(db, userId, templateId));
	const done = await forUser(userId).apply(remove, { templateId });
	return { id: done.value.id, restore: done.value.restore };
}

/** The snapshot a restore token carries, or BAD_REQUEST for a forged, foreign or expired one. */
function snapshotOf(
	userId: string,
	token: RestoreToken,
): RestoreRecurringInput {
	return {
		template: readRestore<TemplateSnapshot>(token, RECURRING_DELETE, userId),
	};
}

/** What the Undo would change and not change; writes nothing. */
export async function previewRestoreTemplate(
	userId: string,
	token: RestoreToken,
) {
	const input = snapshotOf(userId, token);
	const { value, ...preview } = await forUser(userId).preview(
		restoreRecurringFor(input.template),
		input,
	);
	// How many envelopes follow it again, for the sheet's own line.
	return { ...preview, relinkedEnvelopes: value.relinkedEnvelopes };
}

/** Puts the template back. A token works once, like v1's: an old one cannot bring back a version since replaced. */
export async function restoreTemplate(
	db: Parameters<typeof spendSignature>[0],
	userId: string,
	token: RestoreToken,
) {
	const input = snapshotOf(userId, token);
	return spendSignature(db, userId, token.sig, async () => {
		const done = await forUser(userId).apply(
			restoreRecurringFor(input.template),
			input,
		);
		return { id: done.value.id };
	});
}
