import type { ParticipantType, Prisma, PrismaClient } from "~prisma";
import { getImageUrl } from "~/server/storage";
import { resolveClaimAliases } from "./identity";
import type { ParticipantRef } from "./types";

type AppDb = PrismaClient | Prisma.TransactionClient;

/**
 * Settlement statuses that count toward balances. Mirrors balance.ts so the
 * perspective view agrees with computeBalance's optimistic-PROPOSED behaviour.
 */
const BALANCE_SETTLEMENT_STATUSES = ["FINALIZED", "PROPOSED"] as const;

export interface PerspectiveIdentity {
	name: string;
	username: string | null;
	email: string | null;
	avatarUrl: string | null;
	participantType: ParticipantType;
	participantId: string;
	/** True for verified Retrospend users, false for guests and shadow profiles. */
	isVerifiedUser: boolean;
}

export interface PerspectiveLineItem {
	id: string;
	description: string;
	date: Date;
	/** Full transaction amount. */
	amount: number;
	currency: string;
	/** Who paid the expense, resolved to a display identity. */
	paidBy: {
		participantType: ParticipantType;
		participantId: string;
		name: string;
		/** True when the perspective person paid. */
		isPerspective: boolean;
	};
	/** The perspective person's own share of this expense. */
	perspectiveShare: number;
	/** The counterpart's share of this expense. */
	counterpartShare: number;
	/**
	 * The signed contribution of this expense to the net balance, in the
	 * transaction's currency. Positive means it moves the balance toward "the
	 * counterpart owes the perspective person"; negative the other way.
	 */
	signedAmount: number;
}

export interface PerspectiveStatement {
	counterpart: PerspectiveIdentity;
	/**
	 * Net balance per currency, signed from the perspective person's angle:
	 * positive => the counterpart owes the perspective person; negative => the
	 * perspective person owes the counterpart. Only nonzero currencies appear.
	 */
	netByCurrency: Record<string, number>;
	/** The shared expenses behind the balance, newest first. */
	itemized: PerspectiveLineItem[];
}

export interface PerspectiveTotals {
	/** Sum of positive net balances per currency (owed TO the perspective person). */
	owedToPerspective: Record<string, number>;
	/** Sum of negative net balances per currency (owed BY the perspective person), as positive numbers. */
	owedByPerspective: Record<string, number>;
}

export interface BalancesFromPerspectiveResult {
	perspective: PerspectiveIdentity;
	statements: PerspectiveStatement[];
	totals: PerspectiveTotals;
}

interface RawTransaction {
	id: string;
	description: string;
	amount: Prisma.Decimal;
	currency: string;
	date: Date;
	paidByType: ParticipantType;
	paidById: string;
	splitParticipants: Array<{
		participantType: ParticipantType;
		participantId: string;
		shareAmount: Prisma.Decimal;
	}>;
}

interface RawSettlement {
	id: string;
	fromParticipantType: ParticipantType;
	fromParticipantId: string;
	toParticipantType: ParticipantType;
	toParticipantId: string;
	amount: Prisma.Decimal;
	currency: string;
}

function pruneZero(byCurrency: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [currency, value] of Object.entries(byCurrency)) {
		if (Math.abs(value) >= 0.00000001) out[currency] = value;
	}
	return out;
}

/**
 * Computes per-project balances from ONE person's perspective within a single
 * project, returning one statement card per counterpart that has any shared
 * history with the perspective person.
 *
 * This is the RAW PAIRWISE view (real shared expenses between two people), NOT
 * the group-optimal routed settlement plan. It is deliberately project-scoped:
 * every transaction and settlement is restricted to the given projectId.
 *
 * Claim aliases are resolved exactly as computeBalance / getPersonDetail do, so
 * a claimed shadow and its claiming user are one party.
 */
export async function getBalancesFromPerspective(
	db: AppDb,
	projectId: string,
	perspective: ParticipantRef,
): Promise<BalancesFromPerspectiveResult> {
	const prisma = db as PrismaClient;

	// The other project participants are the candidate counterparts.
	const participantRows = await prisma.projectParticipant.findMany({
		where: { projectId },
		select: { participantType: true, participantId: true },
	});

	// Resolve claim aliases across the perspective person and every participant so
	// claimed shadows collapse into their claiming user (a single party).
	const allRefs: ParticipantRef[] = [
		perspective,
		...participantRows.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
		})),
	];
	const { aliasesByKey, canonicalKey } = await resolveClaimAliases(
		prisma,
		allRefs,
	);
	const keyOf = (r: ParticipantRef) => `${r.participantType}:${r.participantId}`;

	const perspectiveCanonical = canonicalKey(perspective);
	const perspectiveRefs = aliasesByKey.get(keyOf(perspective)) ?? [perspective];

	// Build the distinct counterpart list keyed by canonical identity, so two
	// participant rows that resolve to the same person (shadow + claiming user)
	// collapse into one card and the perspective person is never their own
	// counterpart.
	const counterpartByCanonical = new Map<string, ParticipantRef>();
	for (const p of participantRows) {
		const ref: ParticipantRef = {
			participantType: p.participantType,
			participantId: p.participantId,
		};
		const canon = canonicalKey(ref);
		if (canon === perspectiveCanonical) continue;
		if (!counterpartByCanonical.has(canon)) {
			// Store the canonical ref (user for a claimed shadow, else itself).
			const [type, id] = canon.split(/:(.*)/s) as [ParticipantType, string];
			counterpartByCanonical.set(canon, {
				participantType: type,
				participantId: id,
			});
		}
	}

	// Fetch every project transaction the perspective person is involved in
	// (paid it OR is a split participant), across all aliases. Project-scoped.
	const perspectiveInvolvement: Prisma.SharedTransactionWhereInput = {
		OR: perspectiveRefs.flatMap((r) => [
			{ paidByType: r.participantType, paidById: r.participantId },
			{
				splitParticipants: {
					some: {
						participantType: r.participantType,
						participantId: r.participantId,
					},
				},
			},
		]),
	};

	const [rawTransactions, rawSettlements] = await Promise.all([
		prisma.sharedTransaction.findMany({
			where: { projectId, AND: [perspectiveInvolvement] },
			select: {
				id: true,
				description: true,
				amount: true,
				currency: true,
				date: true,
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
			orderBy: { date: "desc" },
		}) as Promise<RawTransaction[]>,
		// Settlements where the perspective person is one party, scoped to THIS
		// project. Settlements are now project-scoped (settlement.projectId), so
		// the per-project perspective view only counts this project's payments and
		// no longer leaks settlements the same pair made in a different project.
		prisma.settlement.findMany({
			where: {
				projectId,
				status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
				OR: [
					{
						OR: perspectiveRefs.map((r) => ({
							fromParticipantType: r.participantType,
							fromParticipantId: r.participantId,
						})),
					},
					{
						OR: perspectiveRefs.map((r) => ({
							toParticipantType: r.participantType,
							toParticipantId: r.participantId,
						})),
					},
				],
			},
			select: {
				id: true,
				fromParticipantType: true,
				fromParticipantId: true,
				toParticipantType: true,
				toParticipantId: true,
				amount: true,
				currency: true,
			},
		}) as Promise<RawSettlement[]>,
	]);

	// Accumulators keyed by counterpart canonical identity.
	const netByCounterpart = new Map<string, Record<string, number>>();
	const itemsByCounterpart = new Map<string, PerspectiveLineItem[]>();

	const getNet = (canon: string) => {
		let m = netByCounterpart.get(canon);
		if (!m) {
			m = {};
			netByCounterpart.set(canon, m);
		}
		return m;
	};
	const addNet = (canon: string, currency: string, value: number) => {
		const m = getNet(canon);
		m[currency] = (m[currency] ?? 0) + value;
	};

	// -- Itemize transactions --------------------------------------------------
	//
	// For each transaction the perspective person is involved in, determine the
	// counterpart(s) and the signed contribution to the pairwise balance:
	//   - perspective paid, counterpart has a share  => +counterpartShare
	//   - counterpart paid, perspective has a share   => -perspectiveShare
	// A transaction can involve several counterparts; it appears on each relevant
	// card with that card's own share figures.
	for (const tx of rawTransactions) {
		const payerCanon = canonicalKey({
			participantType: tx.paidByType,
			participantId: tx.paidById,
		});
		const paidByPerspective = payerCanon === perspectiveCanonical;

		// The perspective person's own share on this transaction (deduped by
		// canonical identity so alias rows do not double count).
		let perspectiveShare = 0;
		const perspectiveSeen = new Set<string>();
		for (const sp of tx.splitParticipants) {
			const spCanon = canonicalKey({
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
			if (spCanon === perspectiveCanonical && !perspectiveSeen.has(spCanon)) {
				perspectiveSeen.add(spCanon);
				perspectiveShare += Number(sp.shareAmount);
			}
		}

		// Aggregate each counterpart's share on this transaction (dedup per canon).
		const shareByCounterpart = new Map<string, number>();
		const seenPerCounterpart = new Set<string>();
		for (const sp of tx.splitParticipants) {
			const spCanon = canonicalKey({
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
			if (spCanon === perspectiveCanonical) continue;
			if (!counterpartByCanonical.has(spCanon)) continue; // not a project counterpart
			const dedupeKey = `${tx.id}|${spCanon}`;
			if (seenPerCounterpart.has(dedupeKey)) continue;
			seenPerCounterpart.add(dedupeKey);
			shareByCounterpart.set(
				spCanon,
				(shareByCounterpart.get(spCanon) ?? 0) + Number(sp.shareAmount),
			);
		}

		if (paidByPerspective) {
			// Perspective paid: each counterpart owes their share to perspective.
			for (const [canon, counterpartShare] of shareByCounterpart) {
				const signed = counterpartShare; // + toward "counterpart owes you"
				addNet(canon, tx.currency, signed);
				pushItem(itemsByCounterpart, canon, {
					id: tx.id,
					description: tx.description,
					date: tx.date,
					amount: Number(tx.amount),
					currency: tx.currency,
					paidBy: {
						participantType: tx.paidByType,
						participantId: tx.paidById,
						name: "", // resolved later
						isPerspective: true,
					},
					perspectiveShare,
					counterpartShare,
					signedAmount: signed,
				});
			}
		} else if (counterpartByCanonical.has(payerCanon) && perspectiveShare > 0) {
			// A counterpart paid and the perspective person has a share: perspective
			// owes that counterpart their own share.
			const canon = payerCanon;
			const counterpartShare = shareByCounterpart.get(canon) ?? 0;
			const signed = -perspectiveShare; // - toward "you owe counterpart"
			addNet(canon, tx.currency, signed);
			pushItem(itemsByCounterpart, canon, {
				id: tx.id,
				description: tx.description,
				date: tx.date,
				amount: Number(tx.amount),
				currency: tx.currency,
				paidBy: {
					participantType: tx.paidByType,
					participantId: tx.paidById,
					name: "",
					isPerspective: false,
				},
				perspectiveShare,
				counterpartShare,
				signedAmount: signed,
			});
		}
	}

	// -- Apply settlements -----------------------------------------------------
	//
	// A settlement from the counterpart TO the perspective person reduces what the
	// counterpart owes (subtract); from perspective TO counterpart increases it
	// (add). Settlements are not shown as line items (they are payments, not
	// shared expenses) but they do move the net.
	const seenSettlement = new Set<string>();
	for (const s of rawSettlements) {
		const fromCanon = canonicalKey({
			participantType: s.fromParticipantType,
			participantId: s.fromParticipantId,
		});
		const toCanon = canonicalKey({
			participantType: s.toParticipantType,
			participantId: s.toParticipantId,
		});

		const perspectiveIsFrom = fromCanon === perspectiveCanonical;
		const perspectiveIsTo = toCanon === perspectiveCanonical;
		if (!perspectiveIsFrom && !perspectiveIsTo) continue;

		const counterpartCanon = perspectiveIsFrom ? toCanon : fromCanon;
		if (!counterpartByCanonical.has(counterpartCanon)) continue;

		const dedupe = `${s.id}|${fromCanon}|${toCanon}`;
		if (seenSettlement.has(dedupe)) continue;
		seenSettlement.add(dedupe);

		if (perspectiveIsTo) {
			// Counterpart paid perspective -> counterpart owes less.
			addNet(counterpartCanon, s.currency, -Number(s.amount));
		} else {
			// Perspective paid counterpart -> counterpart owes more.
			addNet(counterpartCanon, s.currency, Number(s.amount));
		}
	}

	// -- Resolve display identities for perspective + counterparts + payers ----
	const identityRefs: ParticipantRef[] = [perspective];
	for (const ref of counterpartByCanonical.values()) identityRefs.push(ref);
	for (const items of itemsByCounterpart.values()) {
		for (const it of items) {
			identityRefs.push({
				participantType: it.paidBy.participantType,
				participantId: it.paidBy.participantId,
			});
		}
	}
	const identityMap = await resolveIdentities(prisma, identityRefs);

	const perspectiveIdentity = identityMap.get(keyOf(perspective)) ?? {
		name: "Unknown",
		username: null,
		email: null,
		avatarUrl: null,
		participantType: perspective.participantType,
		participantId: perspective.participantId,
		isVerifiedUser: perspective.participantType === "user",
	};

	// -- Assemble statements ---------------------------------------------------
	const statements: PerspectiveStatement[] = [];
	const totals: PerspectiveTotals = {
		owedToPerspective: {},
		owedByPerspective: {},
	};

	for (const [canon, ref] of counterpartByCanonical) {
		const netRaw = netByCounterpart.get(canon) ?? {};
		const net = pruneZero(netRaw);
		const items = itemsByCounterpart.get(canon) ?? [];

		// Include a counterpart when there is any nonzero balance OR any shared
		// history (line items) with the perspective person.
		const hasBalance = Object.keys(net).length > 0;
		const hasHistory = items.length > 0;
		if (!hasBalance && !hasHistory) continue;

		const counterpartIdentity = identityMap.get(keyOf(ref)) ?? {
			name: "Unknown",
			username: null,
			email: null,
			avatarUrl: null,
			participantType: ref.participantType,
			participantId: ref.participantId,
			isVerifiedUser: ref.participantType === "user",
		};

		// Resolve payer names on the items now that identities are known.
		const resolvedItems = items.map((it) => {
			const payerIdentity = identityMap.get(
				`${it.paidBy.participantType}:${it.paidBy.participantId}`,
			);
			return {
				...it,
				paidBy: {
					...it.paidBy,
					name: payerIdentity?.name ?? "Unknown",
				},
			};
		});

		for (const [currency, value] of Object.entries(net)) {
			if (value > 0) {
				totals.owedToPerspective[currency] =
					(totals.owedToPerspective[currency] ?? 0) + value;
			} else if (value < 0) {
				totals.owedByPerspective[currency] =
					(totals.owedByPerspective[currency] ?? 0) + -value;
			}
		}

		statements.push({
			counterpart: counterpartIdentity,
			netByCurrency: net,
			itemized: resolvedItems,
		});
	}

	// Sort: counterparts with a nonzero balance first (by largest absolute
	// balance across currencies), then settled contacts by most recent activity.
	statements.sort((a, b) => {
		const aMax = maxAbs(a.netByCurrency);
		const bMax = maxAbs(b.netByCurrency);
		if (aMax !== bMax) return bMax - aMax;
		const aDate = a.itemized[0]?.date.getTime() ?? 0;
		const bDate = b.itemized[0]?.date.getTime() ?? 0;
		return bDate - aDate;
	});

	return {
		perspective: perspectiveIdentity,
		statements,
		totals: {
			owedToPerspective: pruneZero(totals.owedToPerspective),
			owedByPerspective: pruneZero(totals.owedByPerspective),
		},
	};
}

function maxAbs(byCurrency: Record<string, number>): number {
	let max = 0;
	for (const v of Object.values(byCurrency)) {
		if (Math.abs(v) > max) max = Math.abs(v);
	}
	return max;
}

function pushItem(
	map: Map<string, PerspectiveLineItem[]>,
	canon: string,
	item: PerspectiveLineItem,
) {
	const list = map.get(canon);
	if (list) list.push(item);
	else map.set(canon, [item]);
}

/** Deduplicated identity resolution for a batch of refs. */
async function resolveIdentities(
	db: PrismaClient,
	refs: ParticipantRef[],
): Promise<Map<string, PerspectiveIdentity>> {
	const key = (r: ParticipantRef) => `${r.participantType}:${r.participantId}`;
	const unique = new Map<string, ParticipantRef>();
	for (const r of refs) unique.set(key(r), r);

	const userIds: string[] = [];
	const shadowIds: string[] = [];
	const guestIds: string[] = [];
	for (const r of unique.values()) {
		if (r.participantType === "user") userIds.push(r.participantId);
		else if (r.participantType === "shadow") shadowIds.push(r.participantId);
		else if (r.participantType === "guest") guestIds.push(r.participantId);
	}

	const [users, shadows, guests] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: {
						id: true,
						name: true,
						username: true,
						image: true,
						avatarPath: true,
					},
				})
			: Promise.resolve([]),
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds } },
					select: { id: true, name: true, email: true },
				})
			: Promise.resolve([]),
		guestIds.length > 0
			? db.guestSession.findMany({
					where: { id: { in: guestIds } },
					select: { id: true, name: true, email: true },
				})
			: Promise.resolve([]),
	]);

	const userMap = new Map(users.map((u) => [u.id, u]));
	const shadowMap = new Map(shadows.map((s) => [s.id, s]));
	const guestMap = new Map(guests.map((g) => [g.id, g]));

	const out = new Map<string, PerspectiveIdentity>();
	for (const r of unique.values()) {
		if (r.participantType === "user") {
			const u = userMap.get(r.participantId);
			out.set(key(r), {
				name: u?.name ?? "Unknown User",
				username: u?.username ?? null,
				email: null,
				avatarUrl: getImageUrl(u?.avatarPath ?? null) ?? u?.image ?? null,
				participantType: "user",
				participantId: r.participantId,
				isVerifiedUser: true,
			});
		} else if (r.participantType === "shadow") {
			const s = shadowMap.get(r.participantId);
			out.set(key(r), {
				name: s?.name ?? "Unknown",
				username: null,
				email: s?.email ?? null,
				avatarUrl: null,
				participantType: "shadow",
				participantId: r.participantId,
				isVerifiedUser: false,
			});
		} else {
			const g = guestMap.get(r.participantId);
			out.set(key(r), {
				name: g?.name ?? "Unknown Guest",
				username: null,
				email: g?.email ?? null,
				avatarUrl: null,
				participantType: "guest",
				participantId: r.participantId,
				isVerifiedUser: false,
			});
		}
	}
	return out;
}
