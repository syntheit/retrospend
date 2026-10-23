/**
 * The project Summary tab (MONEY-MOVES §1.10, §4.3): the group total, a
 * table of Paid, Share, Received, Sent and Balance per member and currency,
 * and who pays whom. Callers check that the reader is a member first.
 * Money is `{ minor, currency }`; the client only formats it.
 */
import type { PrismaClient } from "~prisma";
import { batchResolveIdentities } from "./identities";
import { membershipOf } from "./membership";
import { readProjectNumbers } from "./numbers";
import { refKey, type SummaryRef } from "./summary";
import type { ProjectViewer } from "./types";

export async function getProjectSummary(
	db: PrismaClient,
	projectId: string,
	viewer: ProjectViewer,
	periodId?: string,
) {
	const [numbers, rows] = await Promise.all([
		readProjectNumbers(db, projectId, viewer, periodId),
		db.projectParticipant.findMany({
			where: { projectId },
			select: {
				participantType: true,
				participantId: true,
				role: true,
				joinedOn: true,
				leftOn: true,
			},
		}),
	]);
	const people = await batchResolveIdentities(
		db,
		numbers.members.map((m) => m.ref),
	);
	const rowByKey = new Map(rows.map((r) => [refKey(r), r]));
	const person = (ref: SummaryRef) => {
		const identity = people.get(refKey(ref));
		return {
			...ref,
			key: refKey(ref),
			name: identity?.name ?? "Unknown",
			avatarUrl: identity?.avatarUrl ?? null,
		};
	};

	return {
		projectId,
		periodId: periodId ?? null,
		total: numbers.total,
		/** "Balances add up to zero" may be shown only when this is true (I9). */
		balancesAddUp: numbers.imbalance.length === 0,
		imbalance: numbers.imbalance,
		members: numbers.members.map((m) => {
			const row = rowByKey.get(m.key);
			return {
				...person(m.ref),
				/** False for someone on the ledger who is no longer in the project. */
				isMember: row !== undefined,
				role: row?.role ?? null,
				...(row ? membershipOf(row) : { joinedOn: null, leftOn: null }),
				lines: m.lines.map((l) => ({
					currency: l.currency,
					paid: { minor: l.paid, currency: l.currency },
					share: { minor: l.share, currency: l.currency },
					received: { minor: l.received, currency: l.currency },
					sent: { minor: l.sent, currency: l.currency },
					balance: { minor: l.balance, currency: l.currency },
				})),
			};
		}),
		/** The fewest transfers that settle the group, per currency (display only). */
		transfers: numbers.transfers.map((t) => ({
			from: person(t.from),
			to: person(t.to),
			amount: t.amount,
		})),
	};
}
