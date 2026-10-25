import { toMinor, dec } from "~/server/services/envelope/units";
import { frequentSplitPartners } from "~/server/services/people/frequent-partners";
import { insightsFirstDay } from "~/server/services/insights";
import { runwayStats } from "~/server/services/accounts/runway";
import { snooze, unsnooze } from "~/server/services/needs-you/snooze";
import type { Caller } from "./caller";
import type { LedgerCaller } from "./money-op";
import { trpcAuth, trpcProfile, trpcSettings } from "./trpc-bridge";

/**
 * Small v1 reads and writes the Add sheets, the profile page and Needs you
 * make: each is the web's own service or procedure behind one route.
 */

export async function listFrequentPartners(caller: Caller) {
	const rows = await frequentSplitPartners(caller.db, caller.principal.userId);
	return {
		items: rows.map((r) => ({
			type: r.participantType,
			id: r.participantId,
			name: r.name,
			username: r.username,
			email: r.email,
			imageUrl: r.avatarUrl,
		})),
	};
}

export async function snoozeItem(
	caller: LedgerCaller,
	input: { id?: string; itemId: string },
) {
	const result = await snooze(
		caller.db,
		caller.principal.userId,
		{ id: input.id ?? crypto.randomUUID(), itemId: input.itemId },
		{ timeZone: caller.timeZone },
	);
	return { itemId: result.itemId, until: result.until.toISOString() };
}

export const unsnoozeItem = (caller: Caller, itemId: string) =>
	unsnooze(caller.db, caller.principal.userId, { itemId });

export const readFirstDay = (caller: LedgerCaller) =>
	insightsFirstDay(caller.db, caller.principal.userId, {
		timeZone: caller.timeZone,
	});

export async function readLifetimeStats(caller: LedgerCaller) {
	const stats = await (await trpcProfile(caller)).getLifetimeStats();
	return {
		lifetimeSpend: {
			minor: toMinor(dec(stats.lifetimeSpend), stats.homeCurrency),
			currency: stats.homeCurrency,
		},
		totalEntries: stats.totalEntries,
		joinedAt: stats.joinedAt.toISOString(),
	};
}

export async function readAiStatus(caller: LedgerCaller) {
	return (await trpcSettings(caller)).getAiStatus();
}

export async function readRunway(caller: Caller, currency?: string) {
	const home =
		currency ??
		(
			await caller.db.user.findUniqueOrThrow({
				where: { id: caller.principal.userId },
				select: { homeCurrency: true },
			})
		).homeCurrency;
	const stats = await runwayStats(caller.db, caller.principal.userId, home);
	return {
		averageMonthlySpend: {
			minor: toMinor(dec(stats.averageMonthlySpend), home),
			currency: home,
		},
		monthsActive: Math.min(6, Math.max(1, stats.monthsActive)),
	};
}

export async function recordConsent(
	caller: LedgerCaller,
	headers: Headers,
	consentVersion: string,
) {
	await (await trpcAuth({ ...caller, headers })).recordConsent({
		consentVersion,
	});
	return { ok: true as const };
}
