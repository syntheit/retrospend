/**
 * What the Wealth dashboard history (wealth.service.ts) adds on top of its
 * snapshots once money moves link to accounts: the legs a snapshot does not
 * already include (accounts/series.ts rule) and dated rate type switches
 * (D3). With no legs and no switches it adds nothing, so the history of a
 * user who never moved money is exactly what it was.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { dec } from "~/server/services/envelope/units";
import type { AssetType, PrismaClient } from "~prisma";
import { balanceEffect } from "./places";
import { dayOf } from "./series";

interface Held {
	readonly date: Date;
	readonly recordedAt: Date;
}

export interface DashboardLegs {
	/** Days with a leg on or after `since`, so the chart has a point there. */
	readonly days: readonly string[];
	/** Stored-balance change of the legs on top of `held` by the end of `day`. */
	onTop(
		accountId: string,
		type: AssetType,
		held: Held | null,
		day: string,
	): number;
	/** The switched rate type in force on `day` (before the first, the type it replaced); undefined without switches. */
	typeOn(accountId: string, day: string): string | null | undefined;
}

export async function loadDashboardLegs(
	db: PrismaClient,
	userId: string,
	since: Date,
): Promise<DashboardLegs> {
	const [legs, switches] = await Promise.all([
		db.accountLeg.findMany({
			where: {
				userId,
				accountId: { not: null },
				source: { not: "BALANCE_UPDATE" },
			},
			select: { accountId: true, amount: true, date: true, createdAt: true },
			orderBy: { date: "asc" },
		}),
		db.assetRateType.findMany({
			where: { userId },
			select: { accountId: true, from: true, type: true, previousType: true },
			orderBy: [{ from: "asc" }, { createdAt: "asc" }],
		}),
	]);
	const sinceDay = dayOf(since);
	return {
		days: [...new Set(legs.map((l) => dayOf(l.date)))].filter(
			(d) => d >= sinceDay,
		),
		onTop(accountId, type, held, day) {
			let sum: Decimal = dec(0);
			for (const leg of legs) {
				const legDay = dayOf(leg.date);
				if (leg.accountId !== accountId || legDay > day) continue;
				if (
					held &&
					legDay <= dayOf(held.date) &&
					leg.createdAt <= held.recordedAt
				)
					continue;
				sum = sum.add(balanceEffect(type, dec(leg.amount.toString())));
			}
			return sum.toNumber();
		},
		typeOn(accountId, day) {
			const own = switches.filter((s) => s.accountId === accountId);
			let found: string | null | undefined;
			for (const s of own) {
				if (dayOf(s.from) <= day) found = s.type;
			}
			// Before the first switch: the type it replaced (accounts/series.ts typeOn).
			return found === undefined && own[0] ? own[0].previousType : found;
		},
	};
}
