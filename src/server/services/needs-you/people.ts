/**
 * People items: payments someone says they made to you (confirm), splits
 * someone added you to (review) and splits of yours someone rejected (fix
 * the split, SPEC §5.14 "Your split was rejected"). Three queries plus the
 * alias lookup, whatever the number of items.
 *
 * Confirm and review follow peopleWaiting (people/needs.ts), the People
 * page's list; the pg test holds the two to the same ids.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { decimalMoney } from "~/server/services/expense-list/money";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import {
	buildCallerRoleMap,
	deriveCanModify,
} from "~/server/services/shared-expenses/project-permissions";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma } from "~prisma";
import { item } from "./catalog";
import type { NeedsYouAction, NeedsYouItem, PersonKey } from "./types";

type Tx = Prisma.TransactionClient;

export interface PeopleItems {
	readonly items: NeedsYouItem[];
	/** Everyone the items show, by canonical key (a claimed shadow reads as its user). */
	readonly faces: Set<PersonKey>;
}

const SHARED_TX = {
	id: true,
	description: true,
	date: true,
	currency: true,
	paidByType: true,
	paidById: true,
	createdByType: true,
	createdById: true,
	isLocked: true,
	projectId: true,
} as const;

function readRows(tx: Tx, me: ParticipantRef) {
	return Promise.all([
		tx.payment.findMany({
			where: {
				status: "PROPOSED",
				payeeType: me.participantType,
				payeeId: me.participantId,
			},
		}),
		tx.splitParticipant.findMany({
			where: { ...me, verificationStatus: "PENDING" },
			select: { shareAmount: true, transaction: { select: SHARED_TX } },
		}),
		tx.splitParticipant.findMany({
			where: {
				verificationStatus: "REJECTED",
				transaction: {
					createdByType: me.participantType,
					createdById: me.participantId,
				},
			},
			select: {
				participantType: true,
				participantId: true,
				shareAmount: true,
				transaction: { select: SHARED_TX },
			},
		}),
	]);
}

type Rows = Awaited<ReturnType<typeof readRows>>;

const refOf = (type: ParticipantRef["participantType"], id: string) => ({
	participantType: type,
	participantId: id,
});

/** Who is who for one read: the viewer's canonical key; faces collect as items name them. */
interface Who {
	readonly mine: string;
	readonly canonicalKey: (ref: ParticipantRef) => string;
	readonly face: (ref: ParticipantRef) => PersonKey;
	readonly day: (d: Date) => string;
}

function refsOf([payments, pending, rejected]: Rows): ParticipantRef[] {
	const refs: ParticipantRef[] = [];
	for (const p of payments)
		refs.push(
			refOf(p.payerType, p.payerId),
			refOf(p.recordedByType, p.recordedById),
		);
	for (const s of [...pending, ...rejected]) {
		const t = s.transaction;
		refs.push(
			refOf(t.paidByType, t.paidById),
			refOf(t.createdByType, t.createdById),
		);
	}
	for (const s of rejected)
		refs.push(refOf(s.participantType, s.participantId));
	return refs;
}

export async function peopleItems(
	tx: Tx,
	me: ParticipantRef,
	timeZone: string,
): Promise<PeopleItems> {
	const rows = await readRows(tx, me);
	const { canonicalKey } = await resolveClaimAliases(tx, [me, ...refsOf(rows)]);
	const faces = new Set<PersonKey>();
	const who: Who = {
		mine: canonicalKey(me),
		canonicalKey,
		face: (ref) => {
			const key = canonicalKey(ref);
			faces.add(key);
			return key;
		},
		day: (d) => dayKey(d, timeZone),
	};
	const projectIds = [
		...new Set(rows[2].flatMap((r) => r.transaction.projectId ?? [])),
	];
	const roles = await buildCallerRoleMap(tx, [me], projectIds);
	const items = [
		...confirmItems(rows[0], who),
		...reviewItems(rows[1], who),
		...rejectedItems(rows[2], who, roles),
	];
	return { items, faces };
}

/** Someone else says they paid you and recorded it themselves. */
function confirmItems(payments: Rows[0], who: Who): NeedsYouItem[] {
	return payments.flatMap((p) => {
		const payer = refOf(p.payerType, p.payerId);
		const recorder = refOf(p.recordedByType, p.recordedById);
		if (
			who.canonicalKey(payer) === who.mine ||
			who.canonicalKey(recorder) === who.mine
		)
			return [];
		return [
			item("payment.confirm", {
				key: p.id,
				entity: { kind: "payment", id: p.id },
				people: [who.face(payer)],
				amount: decimalMoney(p.amount, p.currency),
				// paidOn is a calendar date as entered; it is read as stored, never shifted.
				date: p.paidOn.toISOString().slice(0, 10),
			}),
		];
	});
}

/** Your pending share; the person asking is the payer, or the creator when you paid. */
function reviewItems(pending: Rows[1], who: Who): NeedsYouItem[] {
	return pending.flatMap((s) => {
		const t = s.transaction;
		const payer = refOf(t.paidByType, t.paidById);
		const asking =
			who.canonicalKey(payer) !== who.mine
				? payer
				: refOf(t.createdByType, t.createdById);
		if (who.canonicalKey(asking) === who.mine) return [];
		return [
			item("split.review", {
				key: t.id,
				entity: { kind: "sharedExpense", id: t.id },
				people: [who.face(asking)],
				amount: decimalMoney(s.shareAmount, t.currency),
				date: who.day(t.date),
				title: t.description,
			}),
		];
	});
}

type RejectedRow = Rows[2][number];

/**
 * What the creator can do about a rejected split, by the same rule the ⋯
 * menu and the write path use (deriveCanModify): Edit while they may, Correct
 * once a payment locked it, otherwise only Open (a VIEWER in its project).
 */
function fixActions(
	t: RejectedRow["transaction"],
	roles: Map<string, string>,
): NeedsYouAction[] {
	const canModify = deriveCanModify({
		isLocked: t.isLocked,
		projectId: t.projectId,
		isCreator: true,
		roleMap: roles,
	});
	if (canModify) return [{ entity: "expense", id: "edit" }];
	if (t.isLocked)
		return [
			{ entity: "expense", id: "correct" },
			{ entity: "expense", id: "open" },
		];
	return [{ entity: "expense", id: "open" }];
}

/** One item per rejected expense, with everyone who rejected it and their shares. */
function rejectedItems(
	rows: Rows[2],
	who: Who,
	roles: Map<string, string>,
): NeedsYouItem[] {
	const byTx = new Map<string, RejectedRow[]>();
	for (const r of rows) {
		const rejecter = refOf(r.participantType, r.participantId);
		if (who.canonicalKey(rejecter) === who.mine) continue;
		byTx.set(r.transaction.id, [...(byTx.get(r.transaction.id) ?? []), r]);
	}
	return [...byTx.values()].map((list) => {
		const t = (list[0] as RejectedRow).transaction;
		return item("split.rejected", {
			key: t.id,
			entity: { kind: "sharedExpense", id: t.id },
			people: list.map((r) =>
				who.face(refOf(r.participantType, r.participantId)),
			),
			amount: {
				minor: list.reduce(
					(sum, r) => sum + decimalMoney(r.shareAmount, t.currency).minor,
					0,
				),
				currency: t.currency,
			},
			date: who.day(t.date),
			title: t.description,
			actions: fixActions(t, roles),
		});
	});
}
