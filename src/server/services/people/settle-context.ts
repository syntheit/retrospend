/**
 * people.settleContext: what the Settle up sheet needs besides the preview
 * (MONEY-MOVES §1, R30). The open balances per project and currency, which
 * way money should go, and the fill amounts the sheet offers ("Everything"
 * and one per currency part), all from allocatePayment itself, so a chip
 * fills exactly what Record then pays. Nothing is written; the preview and
 * the record are payment.record (settlement.paymentPreview / paymentRecord).
 */

import { z } from "zod";
import { dayKey } from "@retrospend/domain/time-zone";
import { assertRelationship } from "~/server/services/payments/access";
import { allocatePayment } from "~/server/services/payments/allocate";
import { participantRefSchema } from "~/server/services/payments/input";
import {
	ledgerLines,
	overallByCurrency,
	payerLines,
} from "~/server/services/payments/ledger";
import { loadQuotes } from "~/server/services/payments/quotes";
import type { ApplyTo, Quote } from "~/server/services/payments/types";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma, PrismaClient } from "~prisma";
import { balanceParts, netOf, rateOf } from "./balances";
import type { RateDTO } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 86_400_000;

export const settleContextSchema = z.object({
	person: participantRefSchema,
	direction: z.enum(["outgoing", "incoming"]).optional(),
	currency: z.string().min(1).max(10).optional(),
	rateType: z.string().min(1).max(32).nullish(),
	/** A project id, or null for Outside projects; omitted = every scope. */
	scope: z.string().min(1).nullable().optional(),
});

export type SettleContextInput = z.infer<typeof settleContextSchema>;

type Money = { minor: number; currency: string };

export interface SettleContext {
	readonly home: string;
	/** The payment currency the sheet starts in (home unless asked). */
	readonly currency: string;
	/** Currencies the sheet offers: home first, then each balance currency. */
	readonly currencies: readonly string[];
	readonly direction: "outgoing" | "incoming";
	/** Which way the open balance points, null when nothing is open. */
	readonly suggested: "outgoing" | "incoming" | null;
	/** Open lines from your side (positive: they owe you), with project names. */
	readonly lines: readonly {
		readonly project: { readonly id: string; readonly name: string } | null;
		readonly amount: Money;
	}[];
	/** "Everything" in the payment currency for this direction; null when nothing is owed that way. */
	readonly everything: Money | null;
	/** One fill per currency part, when more than one currency is owed that way. */
	readonly parts: readonly {
		readonly currency: string;
		readonly full: Money;
	}[];
	/** How each other currency converts into the payment currency. */
	readonly rates: readonly {
		readonly currency: string;
		readonly rate: RateDTO | null;
	}[];
	/** Rate types the converting currencies have. */
	readonly rateTypes: readonly string[];
	/** Currencies owed that way with no rate: left out of Everything. */
	readonly unpriced: readonly string[];
	/** The days the Date chips offer, in the user's zone (payment.record dates the same way). */
	readonly today: string;
	readonly yesterday: string;
}

/**
 * Money should go the way the net points (they owe you: they pay, incoming).
 * Without a net for want of a rate, the first currency part decides.
 */
export function suggestedDirection(
	lines: ReturnType<typeof ledgerLines>,
	currency: string,
	quotes: ReadonlyMap<string, Quote>,
): "outgoing" | "incoming" | null {
	const parts = balanceParts(overallByCurrency(lines), currency, quotes);
	const first = parts[0];
	if (!first) return null;
	const net = netOf(parts, currency);
	return (net ? net.minor : first.amount.minor) >= 0 ? "incoming" : "outgoing";
}

function inScope(scope: string | null | undefined) {
	return (l: { scope: string | null }) =>
		scope === undefined || l.scope === scope;
}

async function projectNames(db: Db, ids: string[]) {
	const rows = await db.project.findMany({
		where: { id: { in: ids } },
		select: { id: true, name: true },
	});
	return new Map(rows.map((p) => [p.id, p]));
}

export async function settleContext(
	db: Db,
	userId: string,
	input: SettleContextInput,
	timeZone?: string,
	now = new Date(),
): Promise<SettleContext> {
	const me: ParticipantRef = { participantType: "user", participantId: userId };
	await assertRelationship(db, me, input.person);
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	const home = user?.homeCurrency ?? "USD";
	const currency = input.currency ?? home;
	const events = await computePairLedger(db, me, input.person, { viewer: me });
	const lines = ledgerLines(events).filter(inScope(input.scope));
	const quotes = await loadQuotes(db, {
		into: currency,
		currencies: lines.map((l) => l.currency),
		date: now,
		rateType: input.rateType,
	});
	const suggested = suggestedDirection(lines, currency, quotes);
	const direction = input.direction ?? suggested ?? "incoming";
	const payer = payerLines(lines, direction === "outgoing");
	const owing = payer.filter((l) => l.owed > 0);
	const scope: ApplyTo[] | undefined =
		input.scope === undefined ? undefined : [{ scope: input.scope }];
	const full = (applyTo?: ApplyTo[]) =>
		allocatePayment({ lines: payer, currency, amount: null, quotes, applyTo })
			.full;
	const everything = full(scope);
	// The payment currency's own part first (it is paid first), then by code.
	const owedCurrencies = [...new Set(owing.map((l) => l.currency))].sort(
		(a, b) => (a === currency ? -1 : b === currency ? 1 : a < b ? -1 : 1),
	);
	const parts =
		owedCurrencies.length > 1
			? owedCurrencies.map((c) => ({
					currency: c,
					full: {
						minor: full([{ ...(scope?.[0] ?? {}), currency: c }]),
						currency,
					},
				}))
			: [];
	const names = await projectNames(
		db,
		lines.flatMap((l) => (l.scope ? [l.scope] : [])),
	);
	const others = [...new Set(lines.map((l) => l.currency))].filter(
		(c) => c !== currency,
	);
	const types = await db.exchangeRate.findMany({
		where: { currency: { in: others } },
		distinct: ["type"],
		select: { type: true },
	});
	return {
		home,
		currency,
		currencies: [...new Set([home, ...lines.map((l) => l.currency)])],
		direction,
		suggested,
		lines: lines.map((l) => ({
			project: l.scope
				? (names.get(l.scope) ?? { id: l.scope, name: "" })
				: null,
			amount: { minor: l.balance, currency: l.currency },
		})),
		everything: everything > 0 ? { minor: everything, currency } : null,
		parts: parts.filter((p) => p.full.minor > 0),
		rates: others.map((c) => ({
			currency: c,
			rate: rateOf(c, currency, quotes.get(c)),
		})),
		rateTypes: types.map((t) => t.type).sort(),
		unpriced: owedCurrencies.filter((c) => c !== currency && !quotes.has(c)),
		today: dayKey(now, timeZone),
		yesterday: dayKey(new Date(now.getTime() - DAY_MS), timeZone),
	};
}
