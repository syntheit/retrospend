/**
 * Figures of the payments engine (IMPLEMENTATION §2.4), registered in
 * src/server/figures/registry.ts:
 * - `balance.person`: the balance with one person per currency, from the
 *   viewer's side (positive = they owe you), never netted across currencies.
 *   Narrowed by `personId` ("type:id") and optionally `projectId`.
 * - `owed.owedToYou` / `owed.youOwe`: everyone's net at the reference rate
 *   in the home currency, split by sign and never netted together (I8).
 * All read through the transaction they are given, so a preview sees its
 * own uncommitted rows.
 */
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
	FigureScope,
	Money,
} from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import { computeBalanceBatch } from "~/server/services/shared-expenses/balance-batch";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { ledgerLines, overallByCurrency } from "./ledger";
import { netInHome, type OwedTotals, owedTotals } from "./owed";
import { loadQuotes } from "./quotes";
import { parsePersonKey } from "./view";

const meOf = (scope: FigureScope): ParticipantRef => ({
	participantType: "user",
	participantId: scope.userId,
});

async function balanceWithPerson(
	db: FigureDb,
	scope: FigureScope,
): Promise<Money[]> {
	const person = scope.personId ? parsePersonKey(scope.personId) : null;
	if (!person) {
		throw new Error('balance.person needs a personId narrowing ("type:id")');
	}
	const me = meOf(scope);
	const events = await computePairLedger(db, me, person, {
		viewer: me,
		...(scope.projectId ? { projectScope: scope.projectId } : {}),
	});
	return [...overallByCurrency(ledgerLines(events))].map(
		([currency, minor]) => ({
			minor,
			currency,
		}),
	);
}

/** Everyone the user shares expenses or payments with, one ref per person (claimed shadows merged). */
async function counterparts(
	db: FigureDb,
	me: ParticipantRef,
): Promise<ParticipantRef[]> {
	const [splitsOnMine, paidForMe, payments] = await Promise.all([
		db.splitParticipant.findMany({
			where: {
				transaction: { paidByType: "user", paidById: me.participantId },
			},
			select: { participantType: true, participantId: true },
			distinct: ["participantType", "participantId"],
		}),
		db.sharedTransaction.findMany({
			where: { splitParticipants: { some: me } },
			select: { paidByType: true, paidById: true },
			distinct: ["paidByType", "paidById"],
		}),
		db.payment.findMany({
			where: {
				OR: [
					{ payerType: "user", payerId: me.participantId },
					{ payeeType: "user", payeeId: me.participantId },
				],
			},
			select: {
				payerType: true,
				payerId: true,
				payeeType: true,
				payeeId: true,
			},
		}),
	]);
	const refs: ParticipantRef[] = [
		...splitsOnMine,
		...paidForMe.map((t) => ({
			participantType: t.paidByType,
			participantId: t.paidById,
		})),
		...payments.flatMap((p) => [
			{ participantType: p.payerType, participantId: p.payerId },
			{ participantType: p.payeeType, participantId: p.payeeId },
		]),
	];
	const { canonicalKey } = await resolveClaimAliases(db, [me, ...refs]);
	const mine = canonicalKey(me);
	const seen = new Set<string>([mine]);
	return refs.filter((ref) => {
		const key = canonicalKey(ref);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export type OwedRead = OwedTotals & { readonly currency: string };

/**
 * Owed to you and You owe in the home currency, or the currencies someone
 * owes in that have no reference rate (named, R14).
 */
export async function owedRead(
	db: FigureDb,
	userId: string,
): Promise<OwedRead | FigureUnavailable> {
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	const home = user?.homeCurrency ?? "USD";
	const people = await counterparts(db, me);
	const balances = await computeBalanceBatch(db, me, people);
	const overall = balances.map(
		(b) => new Map(Object.entries(b.minorByCurrency)),
	);
	const quotes = await loadQuotes(db, {
		into: home,
		currencies: overall.flatMap((m) => [...m.keys()]),
		date: new Date(),
	});
	const nets: number[] = [];
	const missing = new Set<string>();
	for (const byCurrency of overall) {
		const net = netInHome(byCurrency, home, quotes);
		if (net !== null) nets.push(net);
		else
			for (const currency of byCurrency.keys())
				if (currency !== home && !quotes.has(currency)) missing.add(currency);
	}
	if (missing.size) return new FigureUnavailable([...missing]);
	return { ...owedTotals(nets), currency: home };
}

/** owedRead, or null when a rate is missing (People's overview names them itself). */
export async function owedFor(
	db: FigureDb,
	userId: string,
): Promise<OwedRead | null> {
	const owed = await owedRead(db, userId);
	return owed instanceof FigureUnavailable ? null : owed;
}

/** One owed load per read pass: Owed to you, You owe and net worth share it. */
export function owedOnce(
	db: FigureDb,
	userId: string,
	pass?: FigurePass,
): Promise<OwedRead | FigureUnavailable> {
	const load = () => owedRead(db, userId);
	return pass ? pass.once(`owed:${userId}`, load) : load();
}

export const balancePersonFigure: FigureDefinition = {
	id: "balance.person",
	scope: ["personId", "projectId"],
	compute: balanceWithPerson,
};

export const owedToYouFigure: FigureDefinition = {
	id: "owed.owedToYou",
	scope: [],
	compute: async (db, scope, pass) => {
		const owed = await owedOnce(db, scope.userId, pass);
		if (owed instanceof FigureUnavailable) return owed;
		return { minor: owed.owedToYou, currency: owed.currency };
	},
};

export const youOweFigure: FigureDefinition = {
	id: "owed.youOwe",
	scope: [],
	compute: async (db, scope, pass) => {
		const owed = await owedOnce(db, scope.userId, pass);
		if (owed instanceof FigureUnavailable) return owed;
		return { minor: owed.youOwe, currency: owed.currency };
	},
};
