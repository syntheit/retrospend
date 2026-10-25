/**
 * Reads the rows of one Activity page by their keys and shapes them as DTOs:
 * Money in minor units, home values at today's home rate (the totals rule),
 * dates as ISO days in the viewer's zone, faces, payer and permissions.
 */

import { USD } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import type { Prisma } from "~prisma";
import {
	buildCallerRoleMap,
	deriveCanModify,
} from "../shared-expenses/project-permissions";
import {
	categoryRef,
	decimalMoney,
	type HomeRates,
	homeFromUSD,
	homeOf,
} from "./money";
import { firstName, personKeyOf, resolvePeople, type Who } from "./people";
import type { RowKey } from "./query";
import type { ActivityRowDTO, PersonDTO } from "./types";

type Db = Prisma.TransactionClient;

export type ShapeContext = {
	userId: string;
	timeZone: string | undefined;
	rates: HomeRates;
	/** The user's default rate type into their home currency; rows name any other. */
	defaultRateType?: string | null;
};

const categorySelect = {
	select: { id: true, userId: true, name: true, color: true, icon: true },
} as const;

/** The home value only when it differs from the amount's currency. */
function homeField(
	currency: string,
	home: ActivityRowDTO["home"],
	rates: HomeRates,
) {
	return currency === rates.home ? {} : { home };
}

type PersonalRow = {
	direction: "OUT" | "IN";
	entryKind: string;
	inType: string | null;
};

/** How a personal row reads: money in, a refund, an own transfer or spending. */
function personalKind(e: PersonalRow): ActivityRowDTO["kind"] {
	if (e.entryKind === "NOT_SPENDING") return "transfer";
	if (e.direction === "IN") return e.inType === "REFUND" ? "refund" : "income";
	return "expense";
}

async function personalRows(db: Db, ids: string[], c: ShapeContext) {
	if (!ids.length) return [];
	const rows = await db.expense.findMany({
		where: { id: { in: ids }, userId: c.userId },
		include: { category: categorySelect },
	});
	return rows.map((e): ActivityRowDTO => {
		const amount = decimalMoney(e.amount, e.currency);
		const foreign = e.currency !== c.rates.home;
		// A home value booked at save (M2) never moves; others use today's rate.
		const home = !foreign
			? amount
			: e.homeCurrency === c.rates.home && e.homeAmount !== null
				? decimalMoney(e.homeAmount, c.rates.home)
				: homeFromUSD(Number(e.amountInUSD), c.rates);
		const named =
			foreign && e.rateType !== null && e.rateType !== c.defaultRateType;
		const kind = personalKind(e);
		return {
			id: e.id,
			source: "personal",
			entityId: e.id,
			kind,
			title: e.title,
			category: categoryRef(e.category),
			amount,
			...homeField(e.currency, home, c.rates),
			...(named && e.rateType ? { rateType: e.rateType } : {}),
			sortKey: home?.minor ?? null,
			// Money in and transfers add nothing to a total either way.
			...(e.excludeFromAnalytics && (kind === "expense" || kind === "refund")
				? { notCounted: true }
				: {}),
			project: null,
			date: dayKey(e.date, c.timeZone),
			mine: true,
			locked: false,
			canEdit: true,
		};
	});
}

/**
 * Everyone in a split, the payer included. RLS hides the other split rows
 * of a standalone expense from a participant who did not create it (only
 * the creator, project members and each person's own row are visible), so
 * the payer, always on the transaction itself, is added when missing.
 */
function peopleOf(
	t: {
		splitParticipants: { participantType: string; participantId: string }[];
	},
	payerId: string,
): string[] {
	const keys = t.splitParticipants.map((s) =>
		personKeyOf(s.participantType, s.participantId),
	);
	return keys.includes(payerId) ? keys : [payerId, ...keys];
}

/** Your split rows of the page's shared expenses, with what shaping needs. */
async function loadShares(db: Db, ids: string[], c: ShapeContext) {
	const parts = await db.splitParticipant.findMany({
		where: {
			participantType: "user",
			participantId: c.userId,
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
	const txs = parts.map((p) => p.transaction);
	const keys = txs.flatMap((t) => [
		personKeyOf(t.paidByType, t.paidById),
		...t.splitParticipants.map((s) =>
			personKeyOf(s.participantType, s.participantId),
		),
	]);
	const projectIds = [
		...new Set(txs.flatMap((t) => (t.projectId ? [t.projectId] : []))),
	];
	const [who, roles, lookup] = await Promise.all([
		resolvePeople(db, keys),
		buildCallerRoleMap(
			db,
			[{ participantType: "user", participantId: c.userId }],
			projectIds,
		),
		findExchangeRatesForDates(
			db,
			txs.filter((t) => t.exchangeRate === null).map((t) => t.currency),
		),
	]);
	return { parts, who, roles, lookup };
}

type Shares = Awaited<ReturnType<typeof loadShares>>;

function sharedRow(
	{ transaction: t, shareAmount, verificationStatus }: Shares["parts"][number],
	x: Omit<Shares, "parts"> & { c: ShapeContext },
): ActivityRowDTO {
	const me = personKeyOf("user", x.c.userId);
	const rate =
		t.currency === USD
			? 1
			: t.exchangeRate !== null
				? Number(t.exchangeRate)
				: (x.lookup(t.currency, t.date)?.rate ?? null);
	const home = homeOf(Number(t.amount), t.currency, rate, x.c.rates);
	const share =
		homeOf(Number(shareAmount), t.currency, rate, x.c.rates) ??
		decimalMoney(shareAmount, t.currency);
	const payerId = personKeyOf(t.paidByType, t.paidById);
	const mine = t.createdByType === "user" && t.createdById === x.c.userId;
	const face = (key: string): PersonDTO => ({
		id: key,
		name: x.who.get(key)?.name ?? "",
		imageUrl: x.who.get(key)?.imageUrl ?? null,
		isSelf: key === me,
	});
	const waiting =
		verificationStatus === "REJECTED"
			? "rejected"
			: verificationStatus === "PENDING" && !mine
				? "review"
				: null;
	return {
		id: `shared:${t.id}`,
		source: "shared",
		entityId: t.id,
		kind: "expense",
		title: t.description,
		// Another person's category is not usable here (D19): spent() and Insights
		// count the share as No category, so the row shows none too.
		category:
			t.category?.userId === x.c.userId ? categoryRef(t.category) : null,
		amount: decimalMoney(t.amount, t.currency),
		...homeField(t.currency, home, x.c.rates),
		share,
		sortKey: home?.minor ?? null,
		...(waiting ? { waiting } : {}),
		project: t.project,
		people: peopleOf(t, payerId).map(face),
		payerId,
		...(payerId === me ? {} : { payerName: firstName(x.who.get(payerId)) }),
		date: dayKey(t.date, x.c.timeZone),
		mine,
		locked: t.isLocked,
		canEdit: deriveCanModify({
			isLocked: t.isLocked,
			projectId: t.projectId,
			isCreator: mine,
			roleMap: x.roles,
		}),
	};
}

async function sharedRows(db: Db, ids: string[], c: ShapeContext) {
	if (!ids.length) return [];
	const { parts, ...rest } = await loadShares(db, ids, c);
	return parts.map((p) => sharedRow(p, { ...rest, c }));
}

/** Splits a payment key `<group or settlement id>|<currency>`. */
function splitPaymentKey(key: string) {
	const at = key.lastIndexOf("|");
	return { group: key.slice(0, at), currency: key.slice(at + 1) };
}

async function paymentRows(db: Db, keys: string[], c: ShapeContext) {
	if (!keys.length) return [];
	const groups = [...new Set(keys.map((k) => splitPaymentKey(k).group))];
	const rows = await db.settlement.findMany({
		where: {
			isOffset: false,
			kind: "PAYMENT",
			status: { not: "REJECTED" },
			OR: [
				{ paymentGroupId: { in: groups } },
				{ id: { in: groups }, paymentGroupId: null },
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
	const me = personKeyOf("user", c.userId);
	const byKey = new Map<string, typeof rows>();
	for (const r of rows) {
		const key = `${r.paymentGroupId ?? r.id}|${r.currency}`;
		byKey.set(key, [...(byKey.get(key) ?? []), r]);
	}
	const others = rows.flatMap((r) => [
		personKeyOf(r.fromParticipantType, r.fromParticipantId),
		personKeyOf(r.toParticipantType, r.toParticipantId),
	]);
	const [who, lookup] = await Promise.all([
		resolvePeople(db, others),
		findExchangeRatesForDates(
			db,
			rows.map((r) => r.currency),
		),
	]);
	return keys.flatMap((key): ActivityRowDTO[] => {
		const group = byKey.get(key);
		const first = group?.[0];
		if (!group || !first) return [];
		return [paymentRow(key, group, first, { me, who, lookup, c })];
	});
}

type PaymentGroupRow = {
	amount: Prisma.Decimal;
	currency: string;
	status: string;
	initiatedAt: Date;
	fromParticipantType: string;
	fromParticipantId: string;
	toParticipantType: string;
	toParticipantId: string;
	project: { id: string; name: string } | null;
};

function paymentRow(
	key: string,
	group: PaymentGroupRow[],
	first: PaymentGroupRow,
	x: {
		me: string;
		who: Map<string, Who>;
		lookup: Awaited<ReturnType<typeof findExchangeRatesForDates>>;
		c: ShapeContext;
	},
): ActivityRowDTO {
	const from = personKeyOf(first.fromParticipantType, first.fromParticipantId);
	const to = personKeyOf(first.toParticipantType, first.toParticipantId);
	const sent = from === x.me;
	const total = group.reduce((s, r) => s.add(r.amount), first.amount.mul(0));
	const amount = decimalMoney(total, first.currency);
	const rate = x.lookup(first.currency, first.initiatedAt)?.rate ?? null;
	const home = homeOf(Number(total), first.currency, rate, x.c.rates);
	const projects = new Map(
		group.flatMap((r) => (r.project ? [[r.project.id, r.project]] : [])),
	);
	return {
		id: `payment:${key}`,
		source: "payment",
		entityId: key.slice(0, key.lastIndexOf("|")),
		kind: "payment",
		title: "",
		category: null,
		amount,
		...homeField(first.currency, home, x.c.rates),
		sortKey: home?.minor ?? null,
		...(group.some((r) => r.status === "PROPOSED") ? { pending: true } : {}),
		project: projects.size === 1 ? ([...projects.values()][0] ?? null) : null,
		date: dayKey(
			new Date(Math.min(...group.map((r) => r.initiatedAt.getTime()))),
			x.c.timeZone,
		),
		mine: sent,
		locked: true,
		canEdit: false,
		payment: {
			direction: sent ? "sent" : "received",
			counterparty: firstName(x.who.get(sent ? to : from)),
		},
	};
}

/** The DTOs for a page of keys, in the keys' order. */
export async function shapeRows(
	db: Db,
	keys: RowKey[],
	c: ShapeContext,
): Promise<ActivityRowDTO[]> {
	const of = (src: RowKey["src"]) =>
		keys.filter((k) => k.src === src).map((k) => k.id);
	const [p, s, g] = await Promise.all([
		personalRows(db, of("p"), c),
		sharedRows(db, of("s"), c),
		paymentRows(db, of("g"), c),
	]);
	const byId = new Map<string, ActivityRowDTO>();
	for (const r of p) byId.set(`p|${r.id}`, r);
	for (const r of s) byId.set(`s|${r.entityId}`, r);
	for (const r of g) byId.set(`g|${r.id.slice("payment:".length)}`, r);
	return keys.flatMap((k) => {
		const row = byId.get(`${k.src}|${k.id}`);
		return row ? [row] : [];
	});
}
