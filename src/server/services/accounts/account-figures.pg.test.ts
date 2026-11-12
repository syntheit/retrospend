/**
 * Conformance of the two account figure loaders on one ledger. The SQL
 * loaders (loadNetWorthInputs, loadAccountsLedger, loadAccountRows) and the
 * device loaders (netWorthInputsFromRows, accountsLedgerFromRows over rows
 * held in memory, with account balances and balance updates replayed through
 * applyLegs instead of read from the trigger) hand the domain compute the
 * same inputs, so net worth, net worth change with each part, and every
 * account balance match digit for digit. Also the figures by hand.
 *
 * Nothing here reads the process time zone: the figures day by the UTC day
 * (Wealth's history). The run is repeated under TZ=America/Argentina/
 * Buenos_Aires and TZ=UTC; the "now" values straddle UTC midnight.
 *
 * Ana, home ARS. Rates (ARS per USD): Oct 1 blue 1,400 official 1,380 mep
 * 1,390; Oct 14 blue 1,468 official 1,412 mep 1,449. BTC (USD per coin, type
 * crypto): Oct 1 50,000, Oct 14 60,000. The pg harness empties exchange_rate
 * before each file, so the rates are seeded here.
 * Accounts, all opened Oct 1:
 *   Wallet    CASH ARS 1,000,000
 *   Wise      INVESTMENT USD 1,840.55 at Official
 *   Binance   CRYPTO BTC 0.5
 *   Visa      credit card ARS owed 250,000
 *   Loan      loan USD owed 1,000 at MEP
 *   Euros     CASH EUR 80, custom rate EUR 0.8 per USD (no table rate)
 *   Old cash  CASH ARS 5,000, closed Oct 10
 * Then: a late EUR 20 income dated Oct 1 written inside the opening balance
 * (the trigger moves the balance update: EUR 100); Oct 14 wallet income
 * ARS 200,000 booked at ARS 200,000, Wise income USD 2,000 booked at ARS
 * 2,898,000, Binance income BTC 0.1; exchange ARS 442,500 from the wallet
 * for USD 300 in Wise and a fee of ARS 500; Visa payment ARS 100,000 from
 * the wallet; Oct 12 Not tracked USD 50 (a transfer leg); a wallet fee of
 * ARS 1,000 dated Oct 13 written Oct 15; and Oct 14 20:00 Wise balance
 * update to USD 4,100 (Not logged USD -40.55).
 *
 * Balances: Wallet 656,000, Wise 4,100, Binance 0.6, Visa owed 150,000, Loan
 * owed 1,000, Euros 100.
 * Net worth: 656,000 + 4,100 x 1,412 (5,789,200) + 0.6 x 60,000 x 1,468
 * (52,848,000) - 150,000 - 1,000 x 1,449 (1,449,000) + 100 / 0.8 x 1,468
 * (183,500) + Not tracked 50 x 1,468 (73,400) = ARS 57,951,100. People:
 * Paz owes Ana ARS 30,000 and Ana owes Martin ARS 12,000, so ARS
 * 57,969,100 with them.
 * Change since Sep 15 (nothing existed): opened 37,079,959 (Wallet
 * 1,000,000, Wise 1,840.55 x 1,380, Binance 0.5 x 50,000 x 1,400, Visa
 * -250,000, Loan -1,000 x 1,390, Euros 100 / 0.8 x 1,400, Old cash 5,000);
 * income 11,941,000; spending -1,500; exchange -18,900 + Not tracked 50 x
 * 1,400 = 51,100; Not logged -57,256.60; closed -5,000. Total 57,951,100, the
 * net worth without people. Right by hand: income 11,906,000 and
 * revaluation 8,977,797.60 (Binance 9,040,000, Euros 8,500, Wise
 * -15,102.40, Loan -59,000, Not tracked 3,400).
 *
 * KNOWN GAP: the late EUR 20 income is also inside the opening balance, and
 * accountParts counts it twice (in opened and again in income), so the code
 * reads income 11,941,000 and revaluation 8,942,797.60 (Euros -26,500). Only
 * their sum is asserted; the correct split is an it.fails below. Fixing it
 * changes a money figure, an owner call.
 */
import { randomUUID } from "node:crypto";
import {
	type AccountRow,
	accountBalancesFrom,
	accountsLedgerFromRows,
	CHANGE_PARTS,
	type LegRow,
	netWorthChangeFrom,
	netWorthFrom,
	netWorthInputsFromRows,
	notTrackedFrom,
	type OwedReading,
	type SnapshotRow,
} from "@retrospend/domain/accounts/account-figures";
import {
	applyLegs,
	type Leg,
	type LegAccount,
	type LegSnapshot,
	type LegState,
} from "@retrospend/domain/accounts/apply-legs";
import type { AssetType } from "@retrospend/domain/accounts/places";
import { storedOn } from "@retrospend/domain/accounts/series";
import {
	type PickRateRow,
	ratePickFromRows,
} from "@retrospend/domain/accounts/valuation";
import { rateWindow } from "@retrospend/domain/money";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { readFigures } from "~/server/figures/read";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { owedRead } from "~/server/services/payments/figures";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { loadNetWorthInputs, netWorthChangeFor, netWorthFor } from "./figures";
import { loadAccountRows, loadAccountsLedger } from "./load";

const at = (iso: string) => new Date(iso);
/** 22:30 in Buenos Aires on Oct 14: already Oct 15 in UTC. */
const NOW = at("2026-10-15T01:30:00Z");
/** 20:30 in Buenos Aires on Oct 14 and still Oct 14 in UTC. */
const NOW_BEFORE_UTC_MIDNIGHT = at("2026-10-14T23:30:00Z");
const ars = (minor: number) => ({ minor, currency: "ARS" });

interface AccSpec {
	key: string;
	type: AssetType;
	currency: string;
	open: string;
	openUsd: string;
	rate?: string;
	rateType?: string;
	closedAt?: Date;
}

type Step =
	| {
			kind: "leg";
			account: string | null;
			amount: string;
			currency: string;
			date: string;
			createdAt: string;
			source: "INCOME" | "TRANSFER" | "FEE";
			home?: { amount: string; currency: string };
	  }
	| {
			kind: "update";
			account: string;
			balance: string;
			delta: string;
			date: string;
			recordedAt: string;
	  };

const ACCOUNTS: AccSpec[] = [
	{
		key: "wallet",
		type: "CASH",
		currency: "ARS",
		open: "1000000",
		openUsd: "724.64",
	},
	{
		key: "wise",
		type: "INVESTMENT",
		currency: "USD",
		open: "1840.55",
		openUsd: "1840.55",
		rateType: "official",
	},
	{
		key: "binance",
		type: "CRYPTO",
		currency: "BTC",
		open: "0.5",
		openUsd: "25000",
	},
	{
		key: "visa",
		type: "LIABILITY_CREDIT_CARD",
		currency: "ARS",
		open: "250000",
		openUsd: "178.57",
	},
	{
		key: "loan",
		type: "LIABILITY_LOAN",
		currency: "USD",
		open: "1000",
		openUsd: "1000",
		rateType: "mep",
	},
	{
		key: "euros",
		type: "CASH",
		currency: "EUR",
		open: "80",
		openUsd: "100",
		rate: "0.8",
		rateType: "custom",
	},
	{
		key: "oldcash",
		type: "CASH",
		currency: "ARS",
		open: "5000",
		openUsd: "3.57",
		closedAt: at("2026-10-10T00:00:00Z"),
	},
];

const leg = (
	account: string | null,
	source: "INCOME" | "TRANSFER" | "FEE",
	amount: string,
	currency: string,
	date: string,
	createdAt: string,
	home?: { amount: string; currency: string },
): Step => ({
	kind: "leg",
	account,
	amount,
	currency,
	date,
	createdAt,
	source,
	home,
});

const STEPS: Step[] = [
	leg("euros", "INCOME", "20", "EUR", "2026-10-01", "2026-10-01T00:00:00Z"),
	leg(
		"wallet",
		"INCOME",
		"200000",
		"ARS",
		"2026-10-14",
		"2026-10-14T12:00:00Z",
		{
			amount: "200000",
			currency: "ARS",
		},
	),
	leg("wise", "INCOME", "2000", "USD", "2026-10-14", "2026-10-14T12:01:00Z", {
		amount: "2898000",
		currency: "ARS",
	}),
	leg("binance", "INCOME", "0.1", "BTC", "2026-10-14", "2026-10-14T12:02:00Z"),
	leg(
		"wallet",
		"TRANSFER",
		"-442500",
		"ARS",
		"2026-10-14",
		"2026-10-14T12:03:00Z",
	),
	leg("wise", "TRANSFER", "300", "USD", "2026-10-14", "2026-10-14T12:03:00Z"),
	leg("wallet", "FEE", "-500", "ARS", "2026-10-14", "2026-10-14T12:03:00Z"),
	leg(
		"wallet",
		"TRANSFER",
		"-100000",
		"ARS",
		"2026-10-14",
		"2026-10-14T12:04:00Z",
	),
	leg(
		"visa",
		"TRANSFER",
		"100000",
		"ARS",
		"2026-10-14",
		"2026-10-14T12:04:00Z",
	),
	leg(null, "TRANSFER", "50", "USD", "2026-10-12", "2026-10-12T09:00:00Z"),
	{
		kind: "update",
		account: "wise",
		balance: "4100",
		delta: "-40.55",
		date: "2026-10-14",
		recordedAt: "2026-10-14T20:00:00Z",
	},
	leg("wallet", "FEE", "-1000", "ARS", "2026-10-13", "2026-10-15T00:30:00Z"),
];

const RATES: PickRateRow[] = [
	...(
		[
			["2026-10-01", "blue", 1400],
			["2026-10-01", "official", 1380],
			["2026-10-01", "mep", 1390],
			["2026-10-14", "blue", 1468],
			["2026-10-14", "official", 1412],
			["2026-10-14", "mep", 1449],
		] as const
	).map(([day, type, rate]) => ({
		currency: "ARS",
		type,
		rate,
		date: at(`${day}T00:00:00Z`),
	})),
	{
		currency: "BTC",
		type: "crypto",
		rate: 50000,
		date: at("2026-10-01T00:00:00Z"),
	},
	{
		currency: "BTC",
		type: "crypto",
		rate: 60000,
		date: at("2026-10-14T00:00:00Z"),
	},
];

interface World {
	userId: string;
	home: string;
	ids: Map<string, string>;
	/** The leg state after replaying every step through applyLegs. */
	replayed: LegState;
	rows: {
		accounts: AccountRow[];
		snapshots: SnapshotRow[];
		legs: LegRow[];
	};
}

const worlds: string[] = [];

/**
 * A user with `accounts`, then every step through the real trigger and, in
 * the same order, through applyLegs. The device rows come from the replay
 * and the step log, never from the database.
 */
async function buildWorld(
	home: string,
	accounts: AccSpec[],
	steps: Step[],
	timeZone = "America/Argentina/Buenos_Aires",
): Promise<World> {
	const { user } = await createTestUser();
	const userId = user.id;
	worlds.push(userId);
	await adminDb.user.update({
		where: { id: userId },
		data: { homeCurrency: home, timeZone },
	});
	const transfer = await fixtureDb.transfer.create({
		data: {
			userId,
			kind: "TRANSFER",
			date: at("2026-10-01T00:00:00Z"),
			fromAmount: "1",
			fromCurrency: "ARS",
			toAmount: "1",
			toCurrency: "ARS",
		},
	});
	const expense = await fixtureDb.expense.create({
		data: {
			userId,
			title: "p9",
			amount: "1",
			currency: "ARS",
			date: at("2026-10-01T00:00:00Z"),
			amountInUSD: "1",
			exchangeRate: "1",
			pricingSource: "test",
		},
	});
	const prefix = `p9-${randomUUID().slice(0, 8)}`;
	const ids = new Map(accounts.map((a) => [a.key, `${prefix}-${a.key}`]));
	const idOf = (key: string) => ids.get(key) as string;
	const opened = at("2026-10-01T00:00:00Z");

	const meta = new Map<string, string | null>();
	let state: LegState = { accounts: new Map(), snapshots: [] };
	const accountRows: AccountRow[] = [];
	const legAccounts = new Map<string, LegAccount>();
	const snapshots: LegSnapshot[] = [];
	for (const [i, a] of accounts.entries()) {
		const createdAt = new Date(opened.getTime() + i * 1000);
		await fixtureDb.assetAccount.create({
			data: {
				id: idOf(a.key),
				userId,
				name: a.key,
				type: a.type,
				currency: a.currency,
				balance: a.open,
				exchangeRate: a.rate ?? null,
				exchangeRateType: a.rateType ?? null,
				closedAt: a.closedAt ?? null,
				createdAt,
			},
		});
		const snapshotId = `${idOf(a.key)}-s0`;
		await adminDb.assetSnapshot.create({
			data: {
				id: snapshotId,
				accountId: idOf(a.key),
				userId,
				date: opened,
				recordedAt: opened,
				balance: a.open,
				balanceInUSD: a.openUsd,
				currency: a.currency,
				type: a.type,
				exchangeRateType: a.rateType ?? null,
			},
		});
		legAccounts.set(idOf(a.key), {
			type: a.type,
			currency: a.currency,
			balance: a.open,
			countedUnits: "0",
			exchangeRate: a.rate ?? null,
		});
		snapshots.push({
			id: snapshotId,
			accountId: idOf(a.key),
			date: opened,
			balance: a.open,
			balanceInUSD: a.openUsd,
			currency: a.currency,
			recordedAt: opened,
		});
		meta.set(snapshotId, a.rateType ?? null);
		accountRows.push({
			id: idOf(a.key),
			type: a.type,
			currency: a.currency,
			balance: a.open,
			exchangeRate: a.rate ?? null,
			exchangeRateType: a.rateType ?? null,
			closedAt: a.closedAt ?? null,
			createdAt,
		});
	}
	state = { accounts: legAccounts, snapshots };

	const legRows: LegRow[] = [];
	for (const step of steps) {
		if (step.kind === "update") {
			const id = idOf(step.account);
			const spec = accounts.find((a) => a.key === step.account) as AccSpec;
			const snapshotId = `${id}-s${state.snapshots.length}`;
			const date = at(`${step.date}T00:00:00Z`);
			const recordedAt = at(step.recordedAt);
			// What the balance update service writes: the new balance on the
			// account and a snapshot, plus the leg that records the difference.
			await fixtureDb.assetAccount.update({
				where: { id },
				data: { balance: step.balance },
			});
			await adminDb.assetSnapshot.create({
				data: {
					id: snapshotId,
					accountId: id,
					userId,
					date,
					recordedAt,
					balance: step.balance,
					balanceInUSD: step.balance,
					currency: spec.currency,
					type: spec.type,
					exchangeRateType: spec.rateType ?? null,
				},
			});
			const legId = randomUUID();
			await adminDb.accountLeg.create({
				data: {
					id: legId,
					userId,
					accountId: id,
					currency: spec.currency,
					amount: step.delta,
					date,
					source: "BALANCE_UPDATE",
					createdAt: recordedAt,
				},
			});
			const accountsNow = new Map(state.accounts);
			accountsNow.set(id, {
				...(accountsNow.get(id) as LegAccount),
				balance: step.balance,
			});
			state = {
				accounts: accountsNow,
				snapshots: [
					...state.snapshots,
					{
						id: snapshotId,
						accountId: id,
						date,
						balance: step.balance,
						balanceInUSD: step.balance,
						currency: spec.currency,
						recordedAt,
					},
				],
			};
			meta.set(snapshotId, spec.rateType ?? null);
			state = applyLegs(state, [
				{
					op: "insert",
					leg: {
						accountId: id,
						amount: step.delta,
						date,
						createdAt: recordedAt,
						source: "BALANCE_UPDATE",
						countedUnits: "0",
					},
				},
			]);
			legRows.push({
				id: legId,
				accountId: id,
				currency: spec.currency,
				date,
				createdAt: recordedAt,
				amount: step.delta,
				source: "BALANCE_UPDATE",
				homeAmount: null,
				homeCurrency: null,
			});
			continue;
		}
		const id = step.account === null ? null : idOf(step.account);
		const legId = randomUUID();
		const date = at(`${step.date}T00:00:00Z`);
		const createdAt = at(step.createdAt);
		await adminDb.accountLeg.create({
			data: {
				id: legId,
				userId,
				accountId: id,
				currency: step.currency,
				amount: step.amount,
				homeAmount: step.home?.amount ?? null,
				homeCurrency: step.home?.currency ?? null,
				date,
				source: step.source,
				transferId:
					step.source === "TRANSFER" || step.source === "FEE"
						? transfer.id
						: null,
				expenseId:
					step.source === "INCOME" || step.source === "FEE" ? expense.id : null,
				createdAt,
			},
		});
		const replayLeg: Leg = {
			accountId: id,
			amount: step.amount,
			date,
			createdAt,
			source: step.source,
			countedUnits: "0",
		};
		state = applyLegs(state, [{ op: "insert", leg: replayLeg }]);
		legRows.push({
			id: legId,
			accountId: id,
			currency: step.currency,
			date,
			createdAt,
			amount: step.amount,
			source: step.source,
			homeAmount: step.home?.amount ?? null,
			homeCurrency: step.home?.currency ?? null,
		});
	}

	return {
		userId,
		home,
		ids,
		replayed: state,
		rows: {
			accounts: accountRows.map((a) => ({
				...a,
				balance: (state.accounts.get(a.id) as LegAccount).balance.toString(),
			})),
			snapshots: state.snapshots.map((s) => ({
				accountId: s.accountId,
				date: s.date,
				recordedAt: s.recordedAt,
				balance: s.balance.toString(),
				currency: s.currency,
				exchangeRateType: meta.get(s.id) ?? null,
			})),
			legs: legRows,
		},
	};
}

async function seedRates(rows: PickRateRow[]) {
	await adminDb.exchangeRate.createMany({
		data: rows.map((r) => ({
			currency: r.currency,
			type: r.type,
			rate: String(r.rate),
			date: r.date,
		})),
		skipDuplicates: true,
	});
}

async function rateRows(): Promise<PickRateRow[]> {
	const rows = await adminDb.exchangeRate.findMany({
		select: { currency: true, type: true, rate: true, date: true },
	});
	return rows.map((r) => ({ ...r, rate: Number(r.rate) }));
}

const byKey = <T>(rows: T[], key: (row: T) => string) =>
	[...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));

/** Owed to you and You owe as the server reads them: shared money stays server-computed. */
async function owedReading(userId: string): Promise<OwedReading> {
	const owed = await userTransaction(adminDb, userId, (tx) =>
		owedRead(tx, userId),
	);
	return owed instanceof FigureUnavailable
		? { missingRates: owed.missingRates }
		: { owedToYou: owed.owedToYou, youOwe: owed.youOwe };
}

const PICK_GRID = {
	currencies: ["ARS", "BTC", "EUR", "BRL", "CLP", "USD"],
	dates: [
		"2026-09-20T23:59:59.999Z",
		"2026-10-01T23:59:59.999Z",
		"2026-10-12T23:59:59.999Z",
		"2026-10-16T23:59:59.999Z",
	].map(at),
	types: [null, "blue", "official", "mep", "crypto", "custom"],
};

/**
 * Both loaders over one world at `now`: the same inputs, the same pick, the
 * same figures. Returns what the server served, for hand checks.
 */
async function conform(world: World, now: Date) {
	const { userId, home } = world;
	const server = await userTransaction(adminDb, userId, async (tx) => ({
		inputs: await loadNetWorthInputs(tx, userId),
		ledger: await loadAccountsLedger(tx, userId),
		accounts: await loadAccountRows(tx, userId),
		worth: await netWorthFor(tx, userId, undefined, now),
		change: await netWorthChangeFor(tx, userId, 30, now),
	}));
	const owed = await owedReading(userId);
	const pick = ratePickFromRows(await rateRows());
	const deviceInputs = netWorthInputsFromRows({
		home,
		accounts: world.rows.accounts,
		legs: world.rows.legs,
		pick,
		owed,
	});
	const deviceLedger = accountsLedgerFromRows({
		home,
		...world.rows,
		rateSwitches: [],
		pick,
	});

	// The inputs, row for row.
	// The server selects open accounts in SQL; the compute drops closed ones
	// from whatever it is given, so the device hands over all of its rows.
	expect(
		byKey(
			deviceInputs.accounts.filter((a) => a.closedAt === null),
			(a) => a.id,
		),
	).toEqual(byKey(server.inputs.accounts.slice(), (a) => a.id));
	expect(byKey(deviceInputs.notTracked.slice(), (u) => u.currency)).toEqual(
		byKey(server.inputs.notTracked.slice(), (u) => u.currency),
	);
	expect(deviceInputs.owed).toEqual(server.inputs.owed);
	expect(deviceInputs.home).toBe(server.inputs.home);
	expect(deviceLedger.homeCurrency).toBe(server.ledger.homeCurrency);
	expect(deviceLedger.histories).toEqual(server.ledger.histories);
	expect(deviceLedger.notTracked).toEqual(server.ledger.notTracked);
	// The server loads the rows of the currencies the ledger needs; the device
	// holds every row it has. For those currencies the picks are the same.
	const needed = new Set([
		home,
		...world.rows.accounts.map((a) => a.currency),
		...world.rows.legs.map((l) => l.currency),
	]);
	for (const currency of PICK_GRID.currencies.filter((c) => needed.has(c)))
		for (const date of PICK_GRID.dates)
			for (const type of PICK_GRID.types)
				expect(
					pick(currency, date, type),
					`${currency} ${date.toISOString()} ${type}`,
				).toEqual(server.ledger.pick(currency, date, type));

	// The figures.
	const worth = netWorthFrom(deviceInputs, now);
	expect(
		server.worth instanceof FigureUnavailable
			? new FigureUnavailable(worth.missingRates)
			: worth.value,
	).toEqual(server.worth);
	const change = netWorthChangeFrom(deviceLedger, now);
	expect(change).toEqual(server.change);
	if (change) {
		expect(partsSum(change)).toBe(change.total);
	}
	const balances = (rows: AccountRow[], id?: string) =>
		byKey(accountBalancesFrom(rows, id), (m) => m.currency);
	expect(balances(world.rows.accounts)).toEqual(balances(server.accounts));
	for (const id of world.ids.values()) {
		expect(balances(world.rows.accounts, id), id).toEqual(
			balances(
				server.accounts.filter((a) => a.id === id),
				id,
			),
		);
	}
	return { server, change, worth };
}

/** The parts of a change, summed: they add up to the total (I10). */
const partsSum = (change: {
	total: number;
	parts: Readonly<Record<(typeof CHANGE_PARTS)[number], number>>;
}) => CHANGE_PARTS.reduce((sum, part) => sum + change.parts[part], 0);

let ana: World;
let anaId: string;

beforeAll(async () => {
	await seedRates(RATES);
	ana = await buildWorld("ARS", ACCOUNTS, STEPS);
	anaId = ana.userId;
	const martin = await createTestUser();
	worlds.push(martin.user.id);
	const paz = await adminDb.shadowProfile.create({
		data: { createdById: anaId, name: "Paz" },
	});
	const share = (
		payer: { type: "user"; id: string },
		debtor: { type: "user" | "shadow"; id: string },
		amount: string,
	) =>
		adminDb.sharedTransaction.create({
			data: {
				description: "Shared",
				amount,
				currency: "ARS",
				date: at("2026-10-05T15:00:00Z"),
				paidByType: payer.type,
				paidById: payer.id,
				createdByType: payer.type,
				createdById: payer.id,
				splitParticipants: {
					create: [
						{
							participantType: debtor.type,
							participantId: debtor.id,
							shareAmount: amount,
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: payer.type,
							participantId: payer.id,
							shareAmount: "0",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
	await share(
		{ type: "user", id: anaId },
		{ type: "shadow", id: paz.id },
		"30000",
	);
	await share(
		{ type: "user", id: martin.user.id },
		{ type: "user", id: anaId },
		"12000",
	);
});

afterAll(async () => {
	for (const id of worlds) await adminDb.user.delete({ where: { id } });
});

describe("the ledger replayed through applyLegs matches the trigger", () => {
	it("every account balance and balance update, to the last digit", async () => {
		const accounts = await fixtureDb.assetAccount.findMany({
			where: { userId: anaId },
		});
		const snapshots = await adminDb.assetSnapshot.findMany({
			where: { userId: anaId },
		});
		expect(accounts).toHaveLength(ACCOUNTS.length);
		for (const a of accounts) {
			const replayed = ana.replayed.accounts.get(a.id) as LegAccount;
			expect(replayed.balance.toString(), a.name).toBe(a.balance.toString());
		}
		for (const s of snapshots) {
			const replayed = ana.replayed.snapshots.find(
				(r) => r.id === s.id,
			) as LegSnapshot;
			expect(replayed.balance.toString(), s.id).toBe(s.balance.toString());
			expect(replayed.balanceInUSD.toString(), s.id).toBe(
				s.balanceInUSD.toString(),
			);
		}
	});

	it("the balances by hand, and the stored balance equals the history's", async () => {
		const stored = new Map(
			ana.rows.accounts.map((a) => [a.id, a.balance] as const),
		);
		const hand: Record<string, string> = {
			wallet: "656000",
			wise: "4100",
			binance: "0.6",
			visa: "150000",
			loan: "1000",
			euros: "100",
			oldcash: "5000",
		};
		for (const [key, balance] of Object.entries(hand))
			expect(stored.get(ana.ids.get(key) as string), key).toBe(balance);
		const { server } = await conform(ana, NOW);
		const ledger = await userTransaction(adminDb, anaId, (tx) =>
			loadAccountsLedger(tx, anaId),
		);
		for (const history of ledger.histories) {
			// Opening balance plus the legs after it, without the balance update's own.
			expect(
				storedOn(history, "2026-10-16")?.toString(),
				history.account.id,
			).toBe(stored.get(history.account.id));
		}
		expect(server.accounts).toHaveLength(ACCOUNTS.length);
	});
});

describe("Ana's figures, both loaders", () => {
	it("net worth is ARS 57,969,100 with people, ARS 57,951,100 without", async () => {
		const { worth, server } = await conform(ana, NOW);
		expect(worth.value).toEqual(ars(5_796_910_000));
		expect(server.worth).toEqual(ars(5_796_910_000));
		expect(server.inputs.owed).toEqual({
			owedToYou: 3_000_000,
			youOwe: 1_200_000,
		});
	});

	it("the change: total 57,951,100, the right parts by hand, income plus revaluation fixed", async () => {
		const { change } = await conform(ana, NOW);
		expect(change?.currency).toBe("ARS");
		expect(change?.total).toBe(5_795_110_000);
		expect(change?.parts).toMatchObject({
			opened: 3_707_995_900,
			spending: -150_000,
			exchange: 5_110_000,
			notLogged: -5_725_660,
			closed: -500_000,
		});
		// Income and revaluation are not pinned one by one (see the known gap
		// below); what they must add up to is.
		expect((change?.parts.income ?? 0) + (change?.parts.revaluation ?? 0)).toBe(
			1_190_600_000 + 897_779_760,
		);
	});

	// KNOWN GAP, not a pinned expectation: the late EUR 20 income dated Oct 1 and
	// written inside the opening balance update is counted twice by
	// accountParts (packages/domain/src/accounts/net-worth-change.ts): once in
	// "opened" (the first checkpoint, which the trigger moved to EUR 100, already
	// holds it) and again in "income" (every non-update leg in the span counts,
	// even one whose createdAt is not after the checkpoint's recordedAt, the
	// condition series.ts includedIn uses for balances). Today it reads income
	// 1,194,100,000 and Euros revaluation -26,500. Correct: income 1,190,600,000
	// (11,906,000 = 200,000 + 2,898,000 + 8,808,000, no 35,000 for the EUR leg)
	// and revaluation 897,779,760 (Euros +8,500 = 125 USD x (1,468 - 1,400)).
	// Changing the parts changes a money figure: an owner call. When it is fixed,
	// this starts passing and it.fails must become it.
	it.fails("known gap: a leg already inside the opening balance is not also income", async () => {
		const { change } = await conform(ana, NOW);
		expect(change?.parts.income).toBe(1_190_600_000);
		expect(change?.parts.revaluation).toBe(897_779_760);
	});

	it("the same total the evening before UTC midnight (Oct 14, 20:30 Buenos Aires)", async () => {
		const { change } = await conform(ana, NOW_BEFORE_UTC_MIDNIGHT);
		expect(change?.total).toBe(5_795_110_000);
		expect(change?.parts.opened).toBe(3_707_995_900);
	});

	it("balances per currency: open accounts only, liabilities against you", async () => {
		const rows = ana.rows.accounts;
		expect(byKey(accountBalancesFrom(rows), (m) => m.currency)).toEqual([
			ars(50_600_000),
			{ currency: "BTC", minor: 60_000_000 },
			{ currency: "EUR", minor: 10_000 },
			{ currency: "USD", minor: 310_000 },
		]);
		const one = (key: string) =>
			accountBalancesFrom(rows, ana.ids.get(key) as string);
		expect(one("oldcash")).toEqual([ars(500_000)]);
		expect(one("visa")).toEqual([ars(-15_000_000)]);
		expect(one("loan")).toEqual([{ currency: "USD", minor: -100_000 }]);
	});

	it("Not tracked is USD 50", async () => {
		const { server } = await conform(ana, NOW);
		expect(notTrackedFrom(server.inputs.notTracked)).toEqual([
			{ currency: "USD", minor: 5_000 },
		]);
	});

	it("the registry path serves the same net worth, balances and Not tracked", async () => {
		const read = await readFigures(anaId, [
			"netWorth",
			"accounts.balance",
			"notTracked",
		]);
		expect(read.get("netWorth")).toEqual([ars(5_796_910_000)]);
		expect(
			byKey([...(read.get("accounts.balance") ?? [])], (m) => m.currency),
		).toEqual([
			ars(50_600_000),
			{ currency: "BTC", minor: 60_000_000 },
			{ currency: "EUR", minor: 10_000 },
			{ currency: "USD", minor: 310_000 },
		]);
		expect(read.get("notTracked")).toEqual([{ currency: "USD", minor: 5_000 }]);
	});
});

describe("a day ahead of UTC", () => {
	it("income dated Oct 15 is in the change at 23:30 UTC on Oct 14", async () => {
		const world = await buildWorld(
			"ARS",
			[
				{
					key: "wallet",
					type: "CASH",
					currency: "ARS",
					open: "100000",
					openUsd: "72.46",
				},
			],
			[
				leg(
					"wallet",
					"INCOME",
					"10000",
					"ARS",
					"2026-10-15",
					"2026-10-14T23:00:00Z",
					{
						amount: "10000",
						currency: "ARS",
					},
				),
			],
			"Pacific/Auckland",
		);
		for (const now of [NOW_BEFORE_UTC_MIDNIGHT, NOW]) {
			const { change, worth } = await conform(world, now);
			expect(change?.total).toBe(11_000_000);
			expect(change?.parts.opened).toBe(10_000_000);
			expect(change?.parts.income).toBe(1_000_000);
			expect(worth.value).toEqual(ars(11_000_000));
		}
	});
});

describe("home currencies other than ARS", () => {
	it("USD home: ARS 1,000,000 at Official 1,412 is USD 708.22", async () => {
		const world = await buildWorld(
			"USD",
			[
				{
					key: "wallet",
					type: "CASH",
					currency: "ARS",
					open: "1000000",
					openUsd: "708.22",
					rateType: "official",
				},
			],
			[],
		);
		const { worth, change } = await conform(world, NOW);
		// 1,000,000 / 1,412 = 708.2152...
		expect(worth.value).toEqual({ currency: "USD", minor: 70_822 });
		expect(change?.parts.opened).toBe(
			// 1,000,000 / 1,380 = 724.6376... (Oct 1 Official)
			72_464,
		);
		expect(change?.total).toBe(70_822);
	});

	it("CLP home: a rate type behind 20 newer rows is still the one asked for", async () => {
		// mep once on Sep 1, then 25 official rows, one a day: a pick limited to the
		// newest 20 rows never sees mep. The batch lookup has no such limit.
		const rows: PickRateRow[] = [
			{
				currency: "CLP",
				type: "mep",
				rate: 900,
				date: at("2026-09-01T00:00:00Z"),
			},
			...Array.from({ length: 25 }, (_, i) => ({
				currency: "CLP",
				type: "official",
				rate: 950 + i,
				date: at(`2026-09-${String(2 + i).padStart(2, "0")}T00:00:00Z`),
			})),
		];
		await seedRates(rows);
		const world = await buildWorld(
			"CLP",
			[
				{
					key: "wise",
					type: "INVESTMENT",
					currency: "USD",
					open: "100",
					openUsd: "100",
					rateType: "mep",
				},
			],
			[],
		);
		const { worth, server } = await conform(world, NOW);
		expect(worth.value).toEqual({ currency: "CLP", minor: 90_000 });
		const windowed = rateWindow(
			rows.map((r) => ({ type: r.type, rate: r.rate, date: r.date })),
			NOW,
		);
		expect(windowed.some((r) => r.type === "mep")).toBe(false);
		expect(server.ledger.pick("CLP", NOW, "mep")?.rate).toBe(900);
	});
});

describe("a missing rate is unavailable, never 1", () => {
	it("a BRL account with no rate and Not tracked EUR that nets to 0 are named", async () => {
		const world = await buildWorld(
			"ARS",
			[
				{
					key: "wallet",
					type: "CASH",
					currency: "ARS",
					open: "1000",
					openUsd: "0.72",
				},
				{
					key: "real",
					type: "CASH",
					currency: "BRL",
					open: "1000",
					openUsd: "180",
				},
			],
			[
				leg(
					null,
					"TRANSFER",
					"20",
					"EUR",
					"2026-10-12",
					"2026-10-12T09:00:00Z",
				),
				leg(
					null,
					"TRANSFER",
					"-20",
					"EUR",
					"2026-10-12",
					"2026-10-12T09:01:00Z",
				),
			],
		);
		const { worth, change, server } = await conform(world, NOW);
		expect(worth.value).toBeNull();
		expect(byKey([...worth.missingRates], (c) => c)).toEqual(["BRL", "EUR"]);
		expect(server.worth).toEqual(new FigureUnavailable(["BRL", "EUR"]));
		expect(change).toBeNull();
		// Balances need no rate.
		expect(accountBalancesFrom(world.rows.accounts)).toEqual([
			ars(100_000),
			{ currency: "BRL", minor: 100_000 },
		]);
	});

	it("an account with a stored rate and no table rate is valued at the stored one", async () => {
		const world = await buildWorld(
			"ARS",
			[
				{
					key: "real",
					type: "CASH",
					currency: "BRL",
					open: "1000",
					openUsd: "185.19",
					rate: "5.4",
				},
			],
			[],
		);
		const { worth, change } = await conform(world, NOW);
		// 1,000 / 5.4 = 185.185... USD x blue 1,468 = 271,851.85185...
		expect(worth.value).toEqual(ars(27_185_185));
		// Opened Oct 1 at blue 1,400 (259,259.26), then worth 27,185,185 at 1,468.
		expect(change?.parts.opened).toBe(25_925_926);
		expect(change?.total).toBe(27_185_185);
	});
});
