/**
 * The accounts of the parity ledger (E2EE P16): accounts of every kind (a
 * closed one, liabilities, a rate type set), monthly snapshots (a third of
 * them from before the currency column), legs of every source (some Not
 * tracked, some with a booked home value) and rate type switches, two on one
 * day. Legs move the stored balance through the database trigger, as in the
 * app.
 */
import { randomUUID } from "node:crypto";
import {
	computeAmountInUSDDec,
	convertDec,
	roundMoneyDec,
} from "@retrospend/domain/money-dec";
import type { Prisma } from "~prisma";
import { fixtureDb } from "../pg-harness";
import { seedRate } from "./rates";
import {
	chunks,
	D,
	MINUTE,
	type SeedContext,
	SPAN_END,
	SPAN_START,
	text,
} from "./seed-context";

interface AccountSpec {
	type: Prisma.AssetAccountCreateManyInput["type"];
	currency: string;
	minor: number;
	rateType?: string;
	closed?: boolean;
}

const ACCOUNT_SPECS: readonly AccountSpec[] = [
	{ type: "CASH", currency: "ARS", minor: 5_000_000 },
	{ type: "INVESTMENT", currency: "USD", minor: 20_000, rateType: "official" },
	{ type: "CASH", currency: "JPY", minor: 100_000 },
	{ type: "CASH", currency: "USD", minor: 99_900, closed: true },
	{ type: "LIABILITY_CREDIT_CARD", currency: "ARS", minor: 2_500_000 },
	{ type: "REAL_ESTATE", currency: "USD", minor: 8_000_000 },
	{ type: "LIABILITY_LOAN", currency: "ARS", minor: 40_000_000 },
	{ type: "INVESTMENT", currency: "ARS", minor: 9_000_000, rateType: "blue" },
	{ type: "CASH", currency: "KWD", minor: 450_000 },
	{ type: "VEHICLE", currency: "USD", minor: 1_500_000 },
];

/** The spec of the i-th account of the ledger. */
const specOf = (ctx: SeedContext, i: number) =>
	ACCOUNT_SPECS[(i % ctx.size.accounts) % ACCOUNT_SPECS.length] as AccountSpec;

const CREATED = new Date("2025-01-01T00:00:00Z");

/** The accounts; the profile with a currency of no rate gets one more, in it (the last id). */
export async function seedAccounts(ctx: SeedContext): Promise<string[]> {
	const ids: string[] = [];
	const rows: Prisma.AssetAccountCreateManyInput[] = [];
	for (let i = 0; i < ctx.size.accounts; i++) {
		const spec = specOf(ctx, i);
		const id = randomUUID();
		ids.push(id);
		rows.push({
			id,
			userId: ctx.userId,
			name: `account ${i}`,
			type: spec.type,
			currency: spec.currency,
			balance: D(text(spec.minor, spec.currency)),
			exchangeRateType: spec.rateType ?? null,
			closedAt: spec.closed ? new Date("2026-02-01T00:00:00Z") : null,
			createdAt: CREATED,
		});
	}
	if (ctx.profile.withMissingRate) {
		const id = randomUUID();
		ids.push(id);
		rows.push({
			id,
			userId: ctx.userId,
			name: "xqz account",
			type: "CASH",
			currency: "XQZ",
			balance: D("10"),
			createdAt: CREATED,
		});
	}
	await fixtureDb.assetAccount.createMany({ data: rows });
	return ids;
}

/** One snapshot per account and month, so (account, date) stays unique. */
export async function seedSnapshots(
	ctx: SeedContext,
	accountIds: readonly string[],
): Promise<number> {
	const rows: Prisma.AssetSnapshotCreateManyInput[] = [];
	for (let i = 0; i < ctx.size.snapshots; i++) {
		const spec = specOf(ctx, i);
		const date = new Date(Date.UTC(2025, Math.floor(i / ctx.size.accounts), 1));
		const balance = text(
			Math.max(0, spec.minor + ctx.int(-1000, 1000)),
			spec.currency,
		);
		const rate =
			seedRate(spec.currency, spec.rateType ?? "official", date) ??
			seedRate(spec.currency, "official", date);
		// Every third snapshot predates the currency column: it is the account's own.
		const old = i % 3 === 0;
		rows.push({
			id: randomUUID(),
			accountId: accountIds[i % ctx.size.accounts] as string,
			userId: ctx.userId,
			date,
			recordedAt: new Date(date.getTime() + 9 * 60 * MINUTE),
			balance: D(balance),
			balanceInUSD: D(
				computeAmountInUSDDec(balance, spec.currency, rate).toFixed(2),
			),
			currency: old ? null : spec.currency,
			type: old ? null : spec.type,
			exchangeRateType: old ? null : (spec.rateType ?? null),
		});
	}
	await fixtureDb.assetSnapshot.createMany({ data: rows });
	return rows.length;
}

const SOURCES = ["INCOME", "TRANSFER", "FEE", "BALANCE_UPDATE"] as const;

/** The transfer the legs of a ledger name (one, reused). */
async function seedLegTransfer(ctx: SeedContext): Promise<string> {
	const id = randomUUID();
	await fixtureDb.transfer.create({
		data: {
			id,
			userId: ctx.userId,
			kind: "TRANSFER",
			date: new Date(SPAN_START),
			fromAmount: "1",
			fromCurrency: "ARS",
			toAmount: "1",
			toCurrency: "ARS",
		},
	});
	return id;
}

/** The i-th leg: its source decides what it names, and whether it may be Not tracked. */
function legRow(
	ctx: SeedContext,
	i: number,
	accountIds: readonly string[],
	parents: { legParent: string; transferId: string },
): Prisma.AccountLegCreateManyInput {
	const source = SOURCES[i % SOURCES.length] as (typeof SOURCES)[number];
	const named = {
		INCOME: { expenseId: parents.legParent },
		TRANSFER: { transferId: parents.transferId },
		FEE: { transferId: parents.transferId, expenseId: parents.legParent },
		BALANCE_UPDATE: {},
	}[source];
	// Income and balance updates land in an account; the others may be Not tracked.
	const tracked =
		source === "INCOME" || source === "BALANCE_UPDATE" || i % 3 !== 0;
	const spec = specOf(ctx, i);
	const currency = tracked ? spec.currency : ctx.pick(["ARS", "USD", "JPY"]);
	const at = new Date(SPAN_START + ctx.rnd() * (SPAN_END - SPAN_START));
	const amount = text(ctx.int(-200_000, 400_000), currency);
	const booked = ctx.rnd() < 0.3;
	const homeAmount =
		currency === ctx.home
			? amount
			: roundMoneyDec(
					convertDec(
						amount,
						currency,
						seedRate(currency, "official", at),
						ctx.home,
						seedRate(ctx.home, "official", at),
					),
					ctx.home,
				).toFixed();
	return {
		id: randomUUID(),
		userId: ctx.userId,
		accountId: tracked ? (accountIds[i % ctx.size.accounts] as string) : null,
		currency,
		amount: D(amount),
		date: at,
		source,
		...named,
		createdAt: new Date(at.getTime() + 8 * 60 * MINUTE + (i % 20) * MINUTE),
		...(booked ? { homeCurrency: ctx.home, homeAmount: D(homeAmount) } : {}),
	};
}

export async function seedLegs(
	ctx: SeedContext,
	accountIds: readonly string[],
	legParent: string,
): Promise<number> {
	const transferId = await seedLegTransfer(ctx);
	const rows: Prisma.AccountLegCreateManyInput[] = [];
	for (let i = 0; i < ctx.size.legs; i++)
		rows.push(legRow(ctx, i, accountIds, { legParent, transferId }));
	if (ctx.profile.withMissingRate)
		rows.push({
			id: randomUUID(),
			userId: ctx.userId,
			accountId: accountIds[accountIds.length - 1] as string,
			currency: "XQZ",
			amount: D("10"),
			date: ctx.edgeAts[1] as Date,
			source: "INCOME",
			expenseId: legParent,
		});
	for (const part of chunks(rows, 1000))
		await fixtureDb.accountLeg.createMany({ data: part });
	return rows.length;
}

/** Four switches; two on one day, which createdAt orders. */
export async function seedRateSwitches(
	ctx: SeedContext,
	accountIds: readonly string[],
): Promise<number> {
	const froms = [
		"2025-06-01T00:00:00Z",
		"2025-06-01T00:00:00Z",
		"2026-03-10T00:00:00Z",
		"2026-10-14T00:00:00Z",
	];
	const rows = froms.map(
		(from, n): Prisma.AssetRateTypeCreateManyInput => ({
			id: randomUUID(),
			userId: ctx.userId,
			accountId: accountIds[1 + (n % 3)] as string,
			from: new Date(from),
			type: n % 2 === 0 ? "blue" : "official",
			previousType: n % 2 === 0 ? "official" : "blue",
			createdAt: new Date(new Date(from).getTime() + (n + 1) * 60 * MINUTE),
		}),
	);
	await fixtureDb.assetRateType.createMany({ data: rows });
	return rows.length;
}
