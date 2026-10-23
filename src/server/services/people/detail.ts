/**
 * people.page (IMPLEMENTATION §1.1 Person): one person's balance per
 * currency with its rate and the net in the home currency, "Settled since",
 * the balance per project, the payments, the shared expenses with what each
 * does between you, and what waits for you. Today's people.detail stays for
 * the old page; this read reuses its access checks and identity.
 */

import {
	ledgerLines,
	overallByCurrency,
	settledOf,
} from "~/server/services/payments/ledger";
import { loadQuotes } from "~/server/services/payments/quotes";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import { PeopleService } from "~/server/services/shared-expenses/people.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { PrismaClient } from "~prisma";
import { balanceParts, netOf } from "./balances";
import { ledgerRows, paymentsBetween } from "./ledger-rows";
import { peopleWaiting } from "./needs";
import { identityDTO } from "./overview";
import type { PersonPage, ScopeDTO } from "./types";

/** The newest shared expenses the page lists; the footer counts them all. */
export const PERSON_ROWS = 200;

const keyOf = (r: ParticipantRef) => `${r.participantType}:${r.participantId}`;

async function scopesOf(
	db: PrismaClient,
	lines: ReturnType<typeof ledgerLines>,
	rowProjects: readonly string[],
	byScope: readonly { projectId: string | null; since: string | null }[],
): Promise<ScopeDTO[]> {
	const ids = [
		...new Set([
			...lines.map((l) => l.scope).filter((s): s is string => s !== null),
			...rowProjects,
		]),
	];
	const names = new Map(
		(
			await db.project.findMany({
				where: { id: { in: ids } },
				select: { id: true, name: true },
			})
		).map((p) => [p.id, p]),
	);
	const scopes: (string | null)[] = [...ids];
	if (
		lines.some((l) => l.scope === null) ||
		byScope.some((s) => s.projectId === null)
	)
		scopes.push(null);
	return scopes.map((scope) => ({
		project: scope ? (names.get(scope) ?? { id: scope, name: "" }) : null,
		lines: lines
			.filter((l) => l.scope === scope)
			.map((l) => ({ minor: l.balance, currency: l.currency })),
		settledSince: byScope.find((s) => s.projectId === scope)?.since ?? null,
	}));
}

export async function personPage(
	db: PrismaClient,
	userId: string,
	ref: ParticipantRef,
	now = new Date(),
): Promise<PersonPage> {
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	const first = await new PeopleService(db, me).getPersonDetailCursor(ref, {
		limit: PERSON_ROWS,
	});
	const { identity, relationshipStats: stats } = first;
	if (!identity || !stats) throw new Error("the first page has no identity");
	const person = identityDTO(identity);
	const [user, events, { aliasesByKey }] = await Promise.all([
		db.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		}),
		computePairLedger(db, me, ref, { viewer: me }),
		resolveClaimAliases(db, [me, ref]),
	]);
	const home = user?.homeCurrency ?? "USD";
	const mine = aliasesByKey.get(keyOf(me)) ?? [me];
	const theirs = aliasesByKey.get(keyOf(ref)) ?? [ref];
	const lines = ledgerLines(events);
	const overall = overallByCurrency(lines);
	const settled = settledOf(events);
	const [quotes, rows, payments, waiting] = await Promise.all([
		loadQuotes(db, { into: home, currencies: overall.keys(), date: now }),
		ledgerRows(db, first.transactions, {
			mine: new Set(mine.map(keyOf)),
			theirs: new Set(theirs.map(keyOf)),
		}),
		paymentsBetween(db, mine, theirs),
		peopleWaiting(db, me, new Map([[person.key, person]])),
	]);
	const parts = balanceParts(overall, home, quotes);
	const rowProjects = rows.flatMap((r) => (r.project ? [r.project.id] : []));
	return {
		home,
		person,
		net: parts.length ? netOf(parts, home) : { minor: 0, currency: home },
		parts,
		settled: {
			since: settled.since,
			pending: settled.pending,
			nothingShared: settled.nothingShared,
		},
		scopes: await scopesOf(db, lines, rowProjects, settled.byScope),
		payments,
		rows,
		rowCount: stats.transactionCount,
		stats: {
			since: stats.firstTransactionDate
				? stats.firstTransactionDate.toISOString().slice(0, 10)
				: null,
			expenses: stats.transactionCount,
			projects: stats.projectCount,
		},
		needs: waiting.needs,
	};
}
