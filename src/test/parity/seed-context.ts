/**
 * What every per-table seeder of the parity ledger shares (E2EE P16): the
 * user, the deterministic generator, the sizes, the currencies and amounts
 * rows are drawn from, and the instants at the edges of every profile's
 * period. The seeders run in a fixed order, each drawing from the one
 * generator, so the same seed gives the same rows.
 */
import { fromMinor } from "@retrospend/domain/money-minor";
import { spentRange } from "@retrospend/domain/spent";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { Prisma } from "~prisma";
import type { LedgerProfile } from "../device-ledger";

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Rows are seeded over these two instants. */
export const SPAN_START = Date.UTC(2025, 0, 1);
export const SPAN_END = Date.UTC(2027, 1, 1);

export const D = (v: string | number) => new Prisma.Decimal(v);

/** Decimal text of `minor` units of `currency`. */
export const text = (minor: number, currency: string) =>
	fromMinor({ minor, currency });

export const chunks = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
};

/** The ten-line LCG of e2e/fixtures/ledger.ts, copied so the e2e fixtures stay untouched. */
export function lcg(seed: number) {
	let state = seed;
	const rnd = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	return {
		rnd,
		pick: <T>(items: readonly T[]): T =>
			items[Math.floor(rnd() * items.length)] as T,
		int: (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)),
	};
}

export interface ParitySize {
	expenses: number;
	legs: number;
	shares: number;
	accounts: number;
	templates: number;
	snapshots: number;
}

/** The currencies rows are drawn from, ARS most often. */
export const CURRENCIES: readonly string[] = [
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"USD",
	"USD",
	"JPY",
	"KWD",
];

/** Minor units a row of each currency is drawn between. */
const AMOUNT_RANGE: Record<string, [number, number]> = {
	ARS: [100, 5_000_000],
	USD: [100, 50_000],
	JPY: [100, 500_000],
	KWD: [100, 90_000],
	XQZ: [100, 90_000],
};

export interface SeedContext {
	userId: string;
	bobId: string;
	home: string;
	profile: LedgerProfile;
	size: ParitySize;
	clocks: readonly Date[];
	/** 30 minutes either side of every profile's period start and end, for each clock. */
	edgeAts: readonly Date[];
	rnd: () => number;
	pick: <T>(items: readonly T[]) => T;
	int: (lo: number, hi: number) => number;
	/** The user's expense categories, their INCOME one, and Bob's. */
	categoryIds: readonly string[];
	incomeCategory: string;
	bobCategory: string;
	amountOf(currency: string): number;
	dateOf(): Date;
}

type Base = Pick<
	SeedContext,
	| "userId"
	| "bobId"
	| "home"
	| "profile"
	| "size"
	| "clocks"
	| "edgeAts"
	| "categoryIds"
	| "incomeCategory"
	| "bobCategory"
>;

export function seedContext(base: Base, seed: number): SeedContext {
	const { rnd, pick, int } = lcg(seed);
	return {
		...base,
		rnd,
		pick,
		int,
		amountOf: (currency) => {
			const [lo, hi] = AMOUNT_RANGE[currency] as [number, number];
			return int(lo, hi);
		},
		dateOf: () => new Date(SPAN_START + rnd() * (SPAN_END - SPAN_START)),
	};
}

/** Instants 30 minutes, 1 ms and 0 either side of each period start and end of each profile, per clock, for this and the last period. */
export function edgeInstants(
	profiles: readonly LedgerProfile[],
	clocks: readonly Date[],
): Date[] {
	const out: Date[] = [];
	for (const p of profiles)
		for (const clock of clocks) {
			const zone = resolveTimeZone(p.timeZone);
			const now = spentRange(clock, p.startDay, zone);
			const last = spentRange(
				new Date(now.start.getTime() - DAY),
				p.startDay,
				zone,
			);
			for (const r of [now, last])
				for (const edge of [r.start.getTime(), r.end.getTime()])
					for (const d of [-30 * MINUTE, -1, 0, 1, 30 * MINUTE])
						out.push(new Date(edge + d));
		}
	return out;
}
