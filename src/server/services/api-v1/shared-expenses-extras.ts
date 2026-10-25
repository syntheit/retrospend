import type { removeMeSchema } from "@retrospend/api-contract";
import type * as z from "zod";
import { sharedAuthor } from "~/server/services/entry/shared-read";
import { toMinor } from "~/server/services/envelope/units";
import { isoDay } from "./caller";
import type { LedgerCaller } from "./money-op";
import { trpcSharedTransaction, trpcVerification } from "./trpc-bridge";

/**
 * v1 adapters for reading one split expense and the verification calls the
 * Needs you list leads to. The sharedTransaction and verification procedures
 * run in-process, so the membership and role rules are the web's.
 */

type Kind = "user" | "guest" | "shadow";

const money = (amount: number | { toString(): string }, currency: string) => ({
	minor: toMinor(String(amount), currency),
	currency,
});

export async function readSharedExpense(caller: LedgerCaller, id: string) {
	const t = await trpcSharedTransaction(caller);
	const tx = await t.getById({ id });
	const modify = await t.canModify({ transactionId: id });
	const author = await sharedAuthor(caller.db, caller.principal.userId, id);
	const person = (
		p: { participantType: Kind; participantId: string; name: string; avatarUrl: string | null },
	) => ({
		type: p.participantType,
		id: p.participantId,
		name: p.name,
		imageUrl: p.avatarUrl,
	});
	return {
		id: tx.id,
		title: tx.description,
		amount: money(tx.amount, tx.currency),
		date: isoDay(tx.date),
		notes: tx.notes,
		splitMode: tx.splitMode,
		project: tx.projectId
			? { id: tx.projectId, name: tx.projectName ?? "" }
			: null,
		category: tx.category,
		locked: tx.isLocked,
		paidBy: person(tx.paidBy),
		createdBy: {
			type: author.participantType as Kind,
			id: author.participantId,
			name: author.name,
			imageUrl: author.avatarUrl,
			you: author.you,
		},
		splits: tx.splitParticipants.map((sp) => ({
			...person(sp),
			share: money(sp.shareAmount, tx.currency),
			percentage: sp.sharePercentage === null ? null : String(sp.sharePercentage),
			units: sp.shareUnits,
			verification: sp.verificationStatus,
		})),
		hasVerifiedParticipants: tx.hasVerifiedParticipants,
		canEdit: tx.canEdit,
		canDelete: tx.canDelete,
		reason: "reason" in modify ? (modify.reason ?? null) : null,
	};
}

export async function listOutgoingPending(caller: LedgerCaller) {
	const groups = await (await trpcVerification(caller)).outgoing();
	return {
		items: groups.map((g) => ({
			type: g.participantType as Kind,
			id: g.participantId,
			name: g.name,
			imageUrl: g.avatarUrl,
			expenses: g.transactions.map((t) => ({
				id: t.id,
				title: t.description,
				amount: money(t.amount, t.currency),
				date: isoDay(t.date),
				project: t.projectName,
			})),
		})),
	};
}

export async function acceptSharedExpenses(caller: LedgerCaller, ids: string[]) {
	return (await trpcVerification(caller)).bulkAccept({ txnIds: ids });
}

export async function removeMeFromSharedExpense(
	caller: LedgerCaller,
	body: z.infer<typeof removeMeSchema>,
) {
	await (await trpcVerification(caller)).removeSelf({
		txnId: body.id,
		confirmBalanceChange: body.confirmBalanceChange,
	});
	return { ok: true as const };
}
