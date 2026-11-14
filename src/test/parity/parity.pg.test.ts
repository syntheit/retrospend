/**
 * The parity harness (E2EE P16): a device store fed only from the real v1
 * sync routes, held to the server on every device figure, across eight
 * profiles (home currency, zone, fiscal month start) and two instants. The
 * pull driver (pull.ts) calls the routes the way the app will; the engine's
 * apply layer puts what they send in a MemoryStore; compare.ts reads every
 * figure id and variant on both sides.
 *
 * Instants: 2026-10-15T15:00Z, and 2027-01-01T03:30Z, which is 00:30 on
 * January 1 in Buenos Aires and 22:30 on December 31 in New York (whose clock
 * changed on November 1 2026, between the two). Date is faked only around
 * the shares pull (owed is priced at the server's clock) and the reads; every
 * other pull runs on the real clock.
 *
 * A: every id and variant equal, missing currencies included. B: each synced
 * table equals the rows read straight from the database tables (the test
 * builder of P13, engineStoreOf), so what the routes send is held to the
 * columns. C: a delta round after deleting, rejecting, hiding and adding an
 * unpriced row, then undoing all of it. D: every server figure is compared or
 * named server-only. E: history rows that no price reads change nothing.
 */
import { randomUUID } from "node:crypto";
import { dec } from "@retrospend/domain/precise-decimal";
import { spentRange } from "@retrospend/domain/spent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { figures } from "~/server/figures/registry";
import { owedOnce } from "~/server/services/payments/figures";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	DEVICE_FIGURE_IDS,
	serverOnlyReason,
	type TableName,
} from "../../../packages/engine/src/index";
import {
	type Ledger,
	type LedgerProfile,
	P13_PROFILES,
	seedRates,
} from "../device-ledger";
import { engineStoreOf } from "../engine-store";
import { expectParity, readAll } from "./compare";
import {
	addUnpricedShare,
	dropParityRates,
	dropUnpricedShare,
	dropWildHistory,
	type ParityLedger,
	type RateSeed,
	SMALL_SIZE,
	seedParityLedger,
	seedParityRates,
	seedWildHistory,
} from "./ledger";
import {
	type Device,
	expectedCounts,
	newDevice,
	pullAll,
	pullShares,
} from "./pull";

// A pull and a read of every figure on both sides take a while; seeding more.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const CLOCKS = [
	new Date("2026-10-15T15:00:00Z"),
	new Date("2027-01-01T03:30:00Z"),
] as const;
const [FIRST, SECOND] = CLOCKS;

const PROFILES: Record<string, LedgerProfile> = {
	...P13_PROFILES,
	"KWD home, Kuwait, month from the 28th": {
		home: "KWD",
		timeZone: "Asia/Kuwait",
		startDay: 28,
	},
	"USD home, New York": {
		home: "USD",
		timeZone: "America/New_York",
		startDay: 1,
	},
};

interface Entry {
	ledger: ParityLedger;
	device: Device;
}

const entries = new Map<string, Entry>();
const previousDefaultZone = process.env.DEFAULT_TIME_ZONE;
let rateSeed: RateSeed;

/** Runs `fn` with Date at `clock`; the figures and the owed totals read it. */
async function atClock<T>(clock: Date, fn: () => Promise<T>): Promise<T> {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(clock);
	try {
		return await fn();
	} finally {
		vi.useRealTimers();
	}
}

beforeAll(async () => {
	// Auckland is a different local day than Buenos Aires at both instants.
	process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
	await seedRates();
	rateSeed = await seedParityRates(7);
	let seed = 1;
	for (const [name, profile] of Object.entries(PROFILES)) {
		const ledger = await seedParityLedger({
			seed: seed++,
			size: SMALL_SIZE,
			profile,
			clocks: CLOCKS,
		});
		const device = await newDevice(ledger.userId);
		await pullAll(device, await expectedCounts(ledger.userId), {
			shares: false,
		});
		entries.set(name, { ledger, device });
	}
}, 300_000);

afterAll(async () => {
	vi.useRealTimers();
	if (rateSeed) await dropParityRates(rateSeed);
	if (previousDefaultZone === undefined) delete process.env.DEFAULT_TIME_ZONE;
	else process.env.DEFAULT_TIME_ZONE = previousDefaultZone;
});

const refsOf = (ledger: ParityLedger): Ledger & { expenseIds: string[] } => ({
	userId: ledger.userId,
	accountIds: ledger.accountIds,
	templateIds: ledger.templateIds,
	expenseIds: ledger.expenseIds,
});

describe("A: the device reads every figure as the server does", () => {
	for (const [name, profile] of Object.entries(PROFILES))
		describe(name, () => {
			const entry = () => entries.get(name) as Entry;

			for (const clock of CLOCKS)
				it(`at ${clock.toISOString()}`, async () => {
					const { ledger, device } = entry();
					const read = await atClock(clock, async () => {
						await pullShares(device);
						const all = await expectParity(device.store, refsOf(ledger));
						const owed = await userTransaction(adminDb, ledger.userId, (tx) =>
							owedOnce(tx, ledger.userId),
						);
						return { all, owed };
					});
					const { server } = read.all;
					// Not equal because both are null or empty.
					expect(server.readings.get("spent")?.length).toBeGreaterThan(0);
					expect(
						server.readings.get("recurring.cost.out.month"),
					).not.toBeUndefined();
					expect(read.all.keys).toContain("netWorth");
					if (profile.withMissingRate) {
						expect(server.readings.get("glance.spent")).toBeNull();
						expect(server.missing.get("glance.spent")).toEqual(["XQZ"]);
						expect(server.readings.get("netWorth")).toBeNull();
						expect(server.missing.get("netWorth")).toEqual(["XQZ"]);
					} else {
						expect(server.readings.get("glance.spent")).not.toBeNull();
						expect(server.readings.get("netWorth")).not.toBeNull();
						// Shared money is in the net worth, with a balance in a foreign
						// currency that went through a rate: not a zero that both sides agree on.
						expect("missingRates" in read.owed).toBe(false);
						expect(read.owed).toMatchObject({ converted: true });
						expect(
							(read.owed as { owedToYou: number; youOwe: number }).owedToYou +
								(read.owed as { youOwe: number }).youOwe,
						).toBeGreaterThan(0);
					}
					// The device's owed row is the server's reading.
					const row = device.store.get("owed", "owed");
					if ("missingRates" in read.owed)
						expect(row).toEqual({
							id: "owed",
							missingRates: [...read.owed.missingRates],
						});
					else
						expect(row).toEqual({
							id: "owed",
							currency: profile.home,
							owedToYou: read.owed.owedToYou,
							youOwe: read.owed.youOwe,
						});
				});
		});
});

/** The fields of `row` the port row `shape` names. */
function projected<T extends object>(row: object, shape: T): T {
	return Object.fromEntries(
		Object.keys(shape).map((k) => [k, (row as Record<string, unknown>)[k]]),
	) as T;
}

describe("B: the synced tables are the database's rows", () => {
	for (const name of Object.keys(PROFILES))
		it(name, async () => {
			const { ledger, device } = entries.get(name) as Entry;
			await atClock(FIRST, async () => {
				await pullShares(device);
				const expected = await engineStoreOf(ledger.userId);
				const tables: TableName[] = [
					"expenses",
					"categories",
					"recurringTemplates",
					"accounts",
					"snapshots",
					"legs",
					"rateSwitches",
					"shares",
					"owed",
					"settings",
				];
				for (const table of tables) {
					const want = expected.list(table);
					const have = device.store.list(table);
					expect(
						have.map((r) => r.id),
						`${table} ids`,
					).toEqual(want.map((r) => r.id));
					// The device keeps more than the figures read (titles, a template's
					// category id); only the port's own fields are compared.
					expect(
						have.map((r, i) => projected(r, want[i] as object)),
						table,
					).toEqual(want);
				}
				// Rates: the same rows, rates equal as numbers (the column pads, the wire does not).
				const rates = (store: typeof expected) =>
					store.list("rates").map((r) => ({
						id: r.id,
						currency: r.currency,
						type: r.type,
						rate: dec(r.rate).toFixed(),
						date: r.date,
					}));
				expect(rates(device.store as typeof expected)).toEqual(rates(expected));
			});
		});
});

describe("C: a delta round and back", () => {
	// The ARS home profile: the 6th, with a currency that has no rate, is for A.
	const name = "ARS home, alias zone, official default";

	it("applies deletes, a rejected share, a hidden project and unpriced rows, then the undo", async () => {
		const { ledger, device } = entries.get(name) as Entry;
		const refs = refsOf(ledger);
		const zone = resolveTimeZone(PROFILES[name]?.timeZone);
		const range = spentRange(FIRST, 1, zone);
		const first = await atClock(FIRST, async () => {
			await pullShares(device);
			return expectParity(device.store, refs);
		});

		// What changes: an expense that counts this month goes, an accepted share
		// is rejected, the project the user shows is hidden.
		const victim = await fixtureDb.expense.findFirstOrThrow({
			where: {
				userId: ledger.userId,
				status: "FINALIZED",
				direction: "OUT",
				entryKind: "STANDARD",
				isAmortizedParent: false,
				excludeFromAnalytics: false,
				category: { is: null },
				date: { gte: range.start, lte: range.end },
			},
		});
		const share = await adminDb.splitParticipant.findFirstOrThrow({
			where: {
				participantId: ledger.userId,
				participantType: "user",
				verificationStatus: "ACCEPTED",
				transaction: { projectId: null },
			},
		});
		const shown = await adminDb.projectParticipant.findFirstOrThrow({
			where: {
				participantId: ledger.userId,
				participantType: "user",
				excludeFromAnalytics: false,
			},
		});
		await fixtureDb.expense.delete({ where: { id: victim.id } });
		await adminDb.splitParticipant.update({
			where: { id: share.id },
			data: { verificationStatus: "REJECTED" },
		});
		await adminDb.projectParticipant.update({
			where: { id: shown.id },
			data: { excludeFromAnalytics: true },
		});
		// A share in a currency with no rate: priced from the table, so spending is unavailable.
		const xqzShare = await addUnpricedShare(
			ledger.userId,
			ledger.bobId,
			new Date(FIRST.getTime() - 60_000),
		);
		const xqzAccount = randomUUID();
		await fixtureDb.assetAccount.create({
			data: {
				id: xqzAccount,
				userId: ledger.userId,
				name: "no rate",
				type: "CASH",
				currency: "XQZ",
				balance: "5",
			},
		});

		const second = await atClock(FIRST, async () => {
			await pullAll(device, await expectedCounts(ledger.userId));
			return expectParity(device.store, {
				...refs,
				accountIds: [...refs.accountIds, xqzAccount],
			});
		});
		// The unpriced share and account keep both sides' glance and net worth unavailable.
		for (const side of [second.device, second.server]) {
			expect(side.readings.get("glance.spent")).toBeNull();
			expect(side.missing.get("glance.spent")).toEqual(["XQZ"]);
			expect(side.readings.get("netWorth")).toBeNull();
			expect(side.missing.get("netWorth")).toEqual(["XQZ"]);
		}
		expect(device.store.get("expenses", victim.id)).toBeUndefined();
		expect(device.store.get("shares", share.id)?.verificationStatus).toBe(
			"REJECTED",
		);
		expect(device.store.get("settings", "user")?.hiddenProjectIds).toContain(
			shown.projectId,
		);
		// The spending the server reads changed (the deleted row, the rejected share).
		expect(second.server.readings.get("spent")).not.toEqual(
			first.server.readings.get("spent"),
		);

		// Undo it all: the same expense comes back under its id, the share is
		// accepted again, the project shown, the XQZ rows gone.
		await fixtureDb.expense.create({ data: victim });
		await adminDb.splitParticipant.update({
			where: { id: share.id },
			data: { verificationStatus: "ACCEPTED" },
		});
		await adminDb.projectParticipant.update({
			where: { id: shown.id },
			data: { excludeFromAnalytics: false },
		});
		await dropUnpricedShare(xqzShare);
		await adminDb.assetAccount.delete({ where: { id: xqzAccount } });
		const third = await atClock(FIRST, async () => {
			await pullAll(device, await expectedCounts(ledger.userId));
			return expectParity(device.store, refs);
		});
		expect(third.device.readings).toEqual(first.device.readings);
		expect(third.device.missing).toEqual(first.device.missing);
		expect(device.store.list("expenses")).toHaveLength(ledger.counts.expenses);
		expect(device.store.get("accounts", xqzAccount)).toBeUndefined();
	}, 120_000);
});

describe("D: every server figure is compared or named server-only", () => {
	it("leaves none out", async () => {
		const { ledger, device } = entries.get(
			"ARS home, alias zone, official default",
		) as Entry;
		const all = await readAll(device.store, refsOf(ledger));
		const compared = new Set(all.keys.map((k) => k.split("|")[0]));
		for (const id of DEVICE_FIGURE_IDS)
			expect(compared.has(id), `${id} is compared`).toBe(true);
		for (const id of figures.ids)
			if (!compared.has(id))
				expect(serverOnlyReason(id), `${id} has a reason`).toBeDefined();
		// The server-only prefixes the plan names.
		for (const prefix of [
			"entry.",
			"budget.",
			"envelope.",
			"insights.",
			"rate.dollarToday",
			"balance.person",
			"owed.",
			"project.",
			"correction.",
		])
			expect(
				figures.ids.some((id) => id.startsWith(prefix)),
				`${prefix} is a server figure`,
			).toBe(true);
	});
});

describe("E: history rows change no reading", () => {
	it("reads the same before and after rows no price reads are added", async () => {
		const { ledger, device } = entries.get(
			"ARS home, alias zone, official default",
		) as Entry;
		const refs = refsOf(ledger);
		const before = await atClock(SECOND, async () => {
			await pullShares(device);
			return expectParity(device.store, refs);
		});
		const keys = await seedWildHistory();
		try {
			const after = await atClock(SECOND, () =>
				expectParity(device.store, refs),
			);
			expect(after.server.readings).toEqual(before.server.readings);
			expect(after.device.readings).toEqual(before.device.readings);
		} finally {
			await dropWildHistory(keys);
		}
	});
});
