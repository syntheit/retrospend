/**
 * The Person page's "Between you" rows and payments, in minor units. Rows
 * start from today's history read (identity, permissions and the alias
 * aware filter stay in one place); the amounts are read again as Decimals
 * so nothing passes through a float. A row's effect is what it does to
 * your balance with this person: their share of what you paid, or minus
 * your share of what they paid.
 */
import { categoryTone } from "~/lib/category-tone";
import { sumMinor, toMinor } from "~/server/services/envelope/units";
import type { TransactionHistoryItem } from "~/server/services/shared-expenses/people.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, PrismaClient } from "~prisma";
import type { LedgerRowDTO, PaymentDTO } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

const keyOf = (r: { participantType: string; participantId: string }) =>
	`${r.participantType}:${r.participantId}`;

interface Exact {
	amount: { toString(): string };
	currency: string;
	splitParticipants: {
		participantType: string;
		participantId: string;
		shareAmount: { toString(): string };
	}[];
}

/** What one shared expense does between you and them, from your side. */
export function effectOf(
	tx: Exact & { paidByType: string; paidById: string },
	mine: ReadonlySet<string>,
	theirs: ReadonlySet<string>,
): number | null {
	const payer = keyOf({
		participantType: tx.paidByType,
		participantId: tx.paidById,
	});
	const sharesOf = (keys: ReadonlySet<string>) =>
		sumMinor(
			tx.splitParticipants
				.filter((s) => keys.has(keyOf(s)))
				.map((s) => toMinor(s.shareAmount.toString(), tx.currency)),
		);
	if (mine.has(payer)) return sharesOf(theirs);
	if (theirs.has(payer)) return -sharesOf(mine);
	return null;
}

function stateOf(item: TransactionHistoryItem): LedgerRowDTO["state"] {
	if (item.status === "settled") return "settled";
	if (item.myVerificationStatus === "PENDING" && !item.paidBy.isMe)
		return "review";
	if (item.myVerificationStatus === "REJECTED") return "rejected";
	return "ok";
}

export async function ledgerRows(
	db: Db,
	items: readonly TransactionHistoryItem[],
	aliases: { mine: ReadonlySet<string>; theirs: ReadonlySet<string> },
): Promise<LedgerRowDTO[]> {
	const exact = new Map(
		(
			await db.sharedTransaction.findMany({
				where: { id: { in: items.map((i) => i.id) } },
				select: {
					id: true,
					amount: true,
					currency: true,
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
			})
		).map((t) => [t.id, t]),
	);
	return items.flatMap((item): LedgerRowDTO[] => {
		const tx = exact.get(item.id);
		if (!tx) return [];
		const payer = keyOf(item.paidBy);
		const effect = effectOf(tx, aliases.mine, aliases.theirs);
		return [
			{
				id: item.id,
				title: item.description,
				date: item.date.toISOString().slice(0, 10),
				amount: {
					minor: toMinor(tx.amount.toString(), tx.currency),
					currency: tx.currency,
				},
				category: item.category
					? {
							name: item.category.name,
							icon: item.category.icon,
							tone: categoryTone(item.category.color),
						}
					: null,
				project: item.project,
				paidBy: aliases.mine.has(payer)
					? "me"
					: aliases.theirs.has(payer)
						? "them"
						: "other",
				payerName: item.paidBy.name,
				payerId: payer,
				people: item.splitParticipants.map((s) => ({
					id: keyOf(s),
					name: s.name,
					imageUrl: s.avatarUrl,
				})),
				effect:
					effect === null ? null : { minor: effect, currency: tx.currency },
				state: stateOf(item),
				canEdit: item.canEdit,
			},
		];
	});
}

/** Every payment between you and them (both directions, any alias), newest first. Rejected ones are left out. */
export async function paymentsBetween(
	db: Db,
	mine: readonly ParticipantRef[],
	theirs: readonly ParticipantRef[],
): Promise<PaymentDTO[]> {
	const pairs = (
		from: readonly ParticipantRef[],
		to: readonly ParticipantRef[],
	) =>
		from.flatMap((a) =>
			to.map((b) => ({
				payerType: a.participantType,
				payerId: a.participantId,
				payeeType: b.participantType,
				payeeId: b.participantId,
			})),
		);
	const rows = await db.payment.findMany({
		where: {
			status: { in: ["PROPOSED", "FINALIZED"] },
			OR: [...pairs(mine, theirs), ...pairs(theirs, mine)],
		},
		include: {
			settlements: {
				orderBy: { initiatedAt: "asc" },
				select: {
					id: true,
					amount: true,
					currency: true,
					isOffset: true,
					project: { select: { id: true, name: true } },
				},
			},
		},
		orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
	});
	const myKeys = new Set(mine.map(keyOf));
	return rows.map((p) => ({
		id: p.id,
		rowId: p.settlements[0]?.id ?? null,
		direction: myKeys.has(
			keyOf({ participantType: p.payerType, participantId: p.payerId }),
		)
			? "out"
			: "in",
		amount: {
			minor: toMinor(p.amount.toString(), p.currency),
			currency: p.currency,
		},
		paidOn: p.paidOn.toISOString().slice(0, 10),
		method: p.paymentMethod,
		status: p.status === "FINALIZED" ? "final" : "pending",
		recordedByMe: myKeys.has(
			keyOf({
				participantType: p.recordedByType,
				participantId: p.recordedById,
			}),
		),
		parts: p.settlements.map((s) => ({
			project: s.project,
			amount: {
				minor: toMinor(s.amount.toString(), s.currency),
				currency: s.currency,
			},
			offset: s.isOffset,
		})),
	}));
}
