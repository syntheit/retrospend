/**
 * Reads the rows of one Activity page by their keys and shapes them as DTOs:
 * Money in minor units, home values at today's home rate (the totals rule),
 * dates as ISO days in the viewer's zone, faces, payer and permissions.
 *
 * This file is the server loader: it reads the stored rows with SQL and hands
 * them to the pure shaping in @retrospend/domain/activity-rows, which a device
 * runs over rows from its own store (activity-rows-store).
 */

import {
	type ActivityRowDTO,
	type ActivityRowInputs,
	activityRateCurrencies,
	activityRowsFrom,
	type PaymentRowInput,
	type PersonalRowInput,
	personKeyOf,
	type RowKey,
	type SharedRowInput,
	type ShapeContext,
	splitPaymentKey,
} from "@retrospend/domain/activity-rows";
import { findRateRows } from "~/server/exchange-rates";
import type { Prisma } from "~prisma";
import { buildCallerRoleMap } from "../shared-expenses/project-permissions";
import { resolvePeople } from "./people";

export type { ShapeContext };

type Db = Prisma.TransactionClient;

const categorySelect = {
	select: {
		id: true,
		userId: true,
		name: true,
		color: true,
		icon: true,
		kind: true,
	},
} as const;

/** Your own expenses of the page, with their category and monthly parts. */
async function personalRows(
	db: Db,
	ids: string[],
	userId: string,
): Promise<PersonalRowInput[]> {
	if (!ids.length) return [];
	return db.expense
		.findMany({
			where: { id: { in: ids }, userId },
			include: {
				category: categorySelect,
				_count: { select: { children: true } },
			},
		})
		.then((rows) =>
			rows.map((e) => ({ ...e, childCount: e._count.children })),
		);
}

/** Your split rows of the page's shared expenses, with what shaping needs. */
async function loadShares(
	db: Db,
	ids: string[],
	userId: string,
): Promise<SharedRowInput[]> {
	if (!ids.length) return [];
	const parts = await db.splitParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			transactionId: { in: ids },
		},
		select: {
			shareAmount: true,
			verificationStatus: true,
			transaction: {
				include: {
					category: categorySelect,
					project: { select: { id: true, name: true } },
					splitParticipants: {
						select: { participantType: true, participantId: true },
					},
				},
			},
		},
	});
	return parts;
}

/** Every settlement row of the payment groups the keys name, between you and someone. */
async function loadPayments(
	db: Db,
	keys: string[],
	userId: string,
): Promise<PaymentRowInput[]> {
	if (!keys.length) return [];
	const groups = [...new Set(keys.map((k) => splitPaymentKey(k).group))];
	return db.settlement.findMany({
		where: {
			isOffset: false,
			kind: "PAYMENT",
			status: { not: "REJECTED" },
			AND: [
				{
					OR: [
						{ paymentGroupId: { in: groups } },
						{ id: { in: groups }, paymentGroupId: null },
					],
				},
				// Only your own payments, as the list: RLS also shows a project's
				// other members' payments, which are not rows of yours.
				{
					OR: [
						{ fromParticipantType: "user", fromParticipantId: userId },
						{ toParticipantType: "user", toParticipantId: userId },
					],
				},
			],
		},
		select: {
			id: true,
			paymentGroupId: true,
			currency: true,
			amount: true,
			status: true,
			initiatedAt: true,
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
			project: { select: { id: true, name: true } },
		},
	});
}

/**
 * The server loader: the stored rows of a page of keys, the names of the
 * people on them, the caller's role in their projects and the rate rows the
 * shaping prices them with.
 */
export async function loadActivityInputs(
	db: Db,
	keys: readonly RowKey[],
	userId: string,
): Promise<ActivityRowInputs> {
	const of = (src: RowKey["src"]) =>
		keys.filter((k) => k.src === src).map((k) => k.id);
	const [personal, shares, payments] = await Promise.all([
		personalRows(db, of("p"), userId),
		loadShares(db, of("s"), userId),
		loadPayments(db, of("g"), userId),
	]);
	const projectIds = [
		...new Set(
			shares.flatMap((s) =>
				s.transaction.projectId ? [s.transaction.projectId] : [],
			),
		),
	];
	const [who, roles, rateRows] = await Promise.all([
		resolvePeople(db, [
			...shares.flatMap((s) => [
				personKeyOf(s.transaction.paidByType, s.transaction.paidById),
				...s.transaction.splitParticipants.map((p) =>
					personKeyOf(p.participantType, p.participantId),
				),
			]),
			...payments.flatMap((r) => [
				personKeyOf(r.fromParticipantType, r.fromParticipantId),
				personKeyOf(r.toParticipantType, r.toParticipantId),
			]),
		]),
		buildCallerRoleMap(
			db,
			[{ participantType: "user", participantId: userId }],
			projectIds,
		),
		findRateRows(db, activityRateCurrencies({ shares, payments })),
	]);
	return {
		personal,
		shares,
		payments,
		who: Object.fromEntries(who),
		roles: Object.fromEntries(roles),
		rateRows,
	};
}

/** The DTOs for a page of keys, in the keys' order. */
export async function shapeRows(
	db: Db,
	keys: readonly RowKey[],
	c: ShapeContext,
): Promise<ActivityRowDTO[]> {
	return activityRowsFrom(keys, await loadActivityInputs(db, keys, c.userId), c);
}
