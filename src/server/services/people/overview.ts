/**
 * people.overview (IMPLEMENTATION §1.1 People, §3 Direction A, D1): who you
 * share with, each person's balance per currency and net in the home
 * currency, Owed to you and You owe (the figures registry's owed.* numbers,
 * never netted together), the balance bar, pending payments and what waits
 * for you. Today's people.list stays as it is for the old page.
 */
import { userTransaction } from "~/server/db-tx";
import { owedFor } from "~/server/services/payments/figures";
import { loadQuotes } from "~/server/services/payments/quotes";
import { computeBalanceBatch } from "~/server/services/shared-expenses/balance-batch";
import {
	PeopleService,
	type PersonIdentity,
} from "~/server/services/shared-expenses/people.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { PrismaClient } from "~prisma";
import {
	balanceParts,
	barSegments,
	groupOf,
	netOf,
	unpricedOf,
} from "./balances";
import { needsCountByPerson, peopleWaiting } from "./needs";
import type { PeopleOverview, PersonIdentityDTO, PersonSummary } from "./types";

const day = (d: Date) => d.toISOString().slice(0, 10);

export function identityDTO(i: PersonIdentity): PersonIdentityDTO {
	return {
		key: `${i.participantType}:${i.participantId}`,
		type: i.participantType,
		id: i.participantId,
		name: i.name,
		username: i.username,
		imageUrl: i.avatarUrl,
		onRetrospend: i.isVerifiedUser,
	};
}

export async function peopleOverview(
	db: PrismaClient,
	userId: string,
	now = new Date(),
): Promise<PeopleOverview> {
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	const [list, user, owed] = await Promise.all([
		new PeopleService(db, me).listPeople(),
		db.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		}),
		userTransaction(db, userId, (tx) => owedFor(tx, userId)),
	]);
	const home = owed?.currency ?? user?.homeCurrency ?? "USD";
	const identities = new Map(
		list.map((p) => {
			const dto = identityDTO(p.identity);
			return [dto.key, dto] as const;
		}),
	);
	const refs = list.map((p) => ({
		participantType: p.identity.participantType,
		participantId: p.identity.participantId,
	}));
	const [batch, waiting] = await Promise.all([
		computeBalanceBatch(db, me, refs),
		peopleWaiting(db, me, identities),
	]);
	const overall = batch.map((b) => new Map(Object.entries(b.minorByCurrency)));
	const quotes = await loadQuotes(db, {
		into: home,
		currencies: overall.flatMap((m) => [...m.keys()]),
		date: now,
	});
	const counts = needsCountByPerson(waiting.needs);

	const people: PersonSummary[] = list.map((p, i) => {
		const person = identityDTO(p.identity);
		const parts = balanceParts(overall[i] ?? new Map(), home, quotes);
		const net = netOf(parts, home);
		const pending = waiting.pending.get(person.key) ?? null;
		return {
			person,
			group: groupOf(parts, net, pending !== null),
			net: parts.length ? net : { minor: 0, currency: home },
			parts,
			pending,
			needsYou: counts.get(person.key) ?? 0,
			unseen: p.unseenChangesCount,
			lastShared:
				p.mostRecentTransactionDate && p.mostRecentTransactionDescription
					? {
							title: p.mostRecentTransactionDescription,
							date: day(p.mostRecentTransactionDate),
							project: p.mostRecentTransactionProject,
						}
					: null,
		};
	});

	return {
		home,
		owedToYou: owed ? { minor: owed.owedToYou, currency: home } : null,
		youOwe: owed ? { minor: owed.youOwe, currency: home } : null,
		unpriced: unpricedOf(people.map((p) => [...p.parts])),
		people,
		segments: owed
			? barSegments(
					people.map((p) => ({ key: p.person.key, net: p.net })),
					owed.owedToYou,
					owed.youOwe,
				)
			: [],
		needs: waiting.needs,
	};
}
