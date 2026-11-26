/**
 * One balance snapshot per account per day, and the history row beside it
 * (WealthService.recordAssetSnapshot's rules). The snapshot keeps the
 * account's currency, type and rate type, so a later edit of the account
 * does not revalue it. The USD value is rounded to cents here, half to
 * even like the account leg trigger: the column would round half away from
 * zero. Pure: the caller writes the rows (an upsert on account and day).
 */

import { roundUSDDec } from "../money-dec";
import { type DecimalInput, dec } from "../precise-decimal";
import { dayKey } from "../time-zone";
import type { AssetType } from "./places";

/**
 * Which calendar day a snapshot is dated, named by the path that writes it.
 * The paths differ today and each keeps its rule (owner question, slice
 * device-wealth): close and reopen use the UTC day, create and a checkpoint
 * the person's zone. There is no default.
 */
export type SnapshotDayRule =
	| { readonly rule: "utc"; readonly now: Date }
	| {
			readonly rule: "zone";
			readonly now: Date;
			readonly timeZone: string | undefined;
	  };

/** The stored day, as a UTC midnight. */
export function snapshotDay(given: SnapshotDayRule): Date {
	if (given.rule === "utc") {
		const day = new Date(given.now);
		day.setUTCHours(0, 0, 0, 0);
		return day;
	}
	return new Date(`${dayKey(given.now, given.timeZone)}T00:00:00.000Z`);
}

export interface SnapshotMeta {
	readonly currency: string;
	readonly type: AssetType;
	readonly exchangeRateType: string | null | undefined;
}

export interface SnapshotPlanInput {
	/** The stored day (snapshotDay), a UTC midnight. */
	readonly day: Date;
	/** The balance, in the account's currency. */
	readonly units: DecimalInput;
	/** Its value in USD, exact; rounded here. */
	readonly usd: DecimalInput;
	readonly meta: SnapshotMeta;
	/** Orders this balance against legs of the same day (series.ts). */
	readonly recordedAt: Date;
}

export interface SnapshotPlan {
	/** The upsert key, with the account. */
	readonly day: Date;
	readonly row: {
		readonly balance: string;
		readonly balanceInUSD: string;
		readonly currency: string;
		readonly type: AssetType;
		readonly exchangeRateType: string | null;
		readonly recordedAt: Date;
	};
	/** The history row appended on every write. */
	readonly history: { readonly balance: string };
}

export function snapshotPlan(input: SnapshotPlanInput): SnapshotPlan {
	const balance = dec(input.units).toFixed();
	return {
		day: input.day,
		row: {
			balance,
			balanceInUSD: roundUSDDec(input.usd).toFixed(2),
			currency: input.meta.currency,
			type: input.meta.type,
			exchangeRateType: input.meta.exchangeRateType ?? null,
			recordedAt: input.recordedAt,
		},
		history: { balance },
	};
}
