/**
 * What waits for the viewer from the people they share with: payments
 * someone says they made to them (confirm), and splits someone added them
 * to (review). Read only; the Needs you list of the People and Person pages.
 * Also the newest pending payment per person, either way (I5).
 */
import { toMinor } from "~/server/services/envelope/units";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, PrismaClient } from "~prisma";
import type {
	NeedsItemDTO,
	PendingPaymentDTO,
	PersonIdentityDTO,
	PersonKey,
} from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

const day = (d: Date) => d.toISOString().slice(0, 10);

export interface PeopleWaiting {
	readonly needs: NeedsItemDTO[];
	/** The newest pending payment with each person, by canonical person key. */
	readonly pending: Map<PersonKey, PendingPaymentDTO>;
}

/**
 * Reads pending payments and splits waiting for `me`, keyed to the people
 * in `identities` (canonical keys, claimed shadows folded into their user).
 * Anything from someone not in the list is left out.
 */
export async function peopleWaiting(
	db: Db,
	me: ParticipantRef,
	identities: ReadonlyMap<PersonKey, PersonIdentityDTO>,
): Promise<PeopleWaiting> {
	const [payments, splits] = await Promise.all([
		db.payment.findMany({
			where: {
				status: "PROPOSED",
				OR: [
					{ payerType: me.participantType, payerId: me.participantId },
					{ payeeType: me.participantType, payeeId: me.participantId },
				],
			},
			orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
		}),
		db.splitParticipant.findMany({
			where: {
				participantType: me.participantType,
				participantId: me.participantId,
				verificationStatus: "PENDING",
			},
			select: {
				shareAmount: true,
				transaction: {
					select: {
						id: true,
						description: true,
						date: true,
						currency: true,
						paidByType: true,
						paidById: true,
						createdByType: true,
						createdById: true,
					},
				},
			},
			orderBy: { transaction: { date: "desc" } },
		}),
	]);

	const refs: ParticipantRef[] = [me];
	for (const p of payments) {
		refs.push(
			{ participantType: p.payerType, participantId: p.payerId },
			{ participantType: p.payeeType, participantId: p.payeeId },
		);
	}
	for (const s of splits) {
		const t = s.transaction;
		refs.push(
			{ participantType: t.paidByType, participantId: t.paidById },
			{ participantType: t.createdByType, participantId: t.createdById },
		);
	}
	const { canonicalKey } = await resolveClaimAliases(db, refs);
	const mine = canonicalKey(me);
	const who = (r: ParticipantRef) => identities.get(canonicalKey(r));

	const needs: NeedsItemDTO[] = [];
	const pending = new Map<PersonKey, PendingPaymentDTO>();
	for (const p of payments) {
		const payer = { participantType: p.payerType, participantId: p.payerId };
		const payee = { participantType: p.payeeType, participantId: p.payeeId };
		const iPaid = canonicalKey(payer) === mine;
		const person = who(iPaid ? payee : payer);
		if (!person) continue;
		const amount = {
			minor: toMinor(p.amount.toString(), p.currency),
			currency: p.currency,
		};
		if (!pending.has(person.key))
			pending.set(person.key, { direction: iPaid ? "out" : "in", amount });
		const recordedByMe =
			canonicalKey({
				participantType: p.recordedByType,
				participantId: p.recordedById,
			}) === mine;
		if (!iPaid && !recordedByMe)
			needs.push({
				kind: "confirmPayment",
				id: p.id,
				person,
				amount,
				paidOn: day(p.paidOn),
			});
	}
	for (const s of splits) {
		const t = s.transaction;
		const payer = { participantType: t.paidByType, participantId: t.paidById };
		const creator = {
			participantType: t.createdByType,
			participantId: t.createdById,
		};
		const asking = canonicalKey(payer) !== mine ? payer : creator;
		if (canonicalKey(asking) === mine) continue;
		const person = who(asking);
		if (!person) continue;
		needs.push({
			kind: "verify",
			id: t.id,
			person,
			title: t.description,
			amount: {
				minor: toMinor(s.shareAmount.toString(), t.currency),
				currency: t.currency,
			},
			date: day(t.date),
		});
	}
	return { needs, pending };
}

/** How many items wait for the viewer per person. */
export function needsCountByPerson(
	needs: readonly NeedsItemDTO[],
): Map<PersonKey, number> {
	const out = new Map<PersonKey, number>();
	for (const n of needs)
		out.set(n.person.key, (out.get(n.person.key) ?? 0) + 1);
	return out;
}
