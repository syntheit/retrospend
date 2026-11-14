/**
 * The device figure registry held to the server's, figure by figure, on the
 * same Postgres rows. The device side reads a MemoryStore built from the raw
 * rows (src/test/engine-store.ts); the server side reads the real registry
 * through a user transaction. For every device figure id the two readings and
 * the currencies that kept a figure out must be equal, for several profiles:
 * home currencies ARS, USD and JPY, a stored zone that is an alias, missing or
 * unsupported (the server falls back to DEFAULT_TIME_ZONE), a fiscal month
 * that starts on the 15th or the 28th, rows 23:30 local on the last day of
 * the month, a hidden project, and a currency with no rate at all.
 *
 * The clock is the fake system Date only, as the critic round asked: the
 * device registry reads `new Date()` per pass, like the server's figures.
 * Owed to you and You owe are shared money, so the device is handed the
 * server's own reading (owedOnce), as sync will hand it.
 */
import { randomUUID } from "node:crypto";
import {
	FigurePass,
	type FigureReading,
	readFiguresIn,
} from "@retrospend/domain/figures/registry";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { createExpense } from "~/server/services/expense-create.mutation";
import { owedOnce } from "~/server/services/payments/figures";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
// The root app does not depend on the engine package; it is imported by path.
import {
	createDevicePreviewRunner,
	DEVICE_FIGURE_IDS,
	deviceFigures,
	EXPENSE_CREATE_MUTATION,
	serverOnlyReason,
} from "../../../packages/engine/src/index";
import {
	type Ledger,
	type LedgerProfile,
	seedLedger,
	seedRates,
} from "../../test/device-ledger";
import { engineStoreOf } from "../../test/engine-store";
import { figures } from "./registry";
import { FigureUnavailable } from "./unavailable";

const NOW = new Date("2026-10-15T15:00:00Z");
const BA = "America/Argentina/Buenos_Aires";
const D = (v: string) => new Prisma.Decimal(v);

const PROFILES: Record<string, LedgerProfile> = {
	"ARS home, alias zone, official default": {
		home: "ARS",
		timeZone: BA,
		startDay: 1,
		defaultRateTypes: { ARS: "official" },
	},
	"USD home, Tokyo": { home: "USD", timeZone: "Asia/Tokyo", startDay: 1 },
	"JPY home, month from the 15th": {
		home: "JPY",
		timeZone: "Asia/Tokyo",
		startDay: 15,
	},
	"ARS home, no stored zone, DEFAULT_TIME_ZONE set": {
		home: "ARS",
		timeZone: null,
		startDay: 1,
	},
	"ARS home, unsupported stored zone, month from the 28th": {
		home: "ARS",
		timeZone: "Mars/Olympus",
		startDay: 28,
	},
	"ARS home, a currency with no rate": {
		home: "ARS",
		timeZone: BA,
		startDay: 1,
		withMissingRate: true,
	},
};

const ledgers = new Map<string, Ledger>();
const previousDefaultZone = process.env.DEFAULT_TIME_ZONE;

beforeAll(async () => {
	// Auckland is a different local day than Buenos Aires at NOW.
	process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	await seedRates();
	for (const [name, profile] of Object.entries(PROFILES))
		ledgers.set(name, await seedLedger(profile, NOW));
});

afterAll(() => {
	vi.useRealTimers();
	if (previousDefaultZone === undefined) delete process.env.DEFAULT_TIME_ZONE;
	else process.env.DEFAULT_TIME_ZONE = previousDefaultZone;
});

interface Read {
	readings: ReadonlyMap<string, FigureReading>;
	missing: ReadonlyMap<string, string[]>;
}

async function owedOf(userId: string) {
	return userTransaction(adminDb, userId, (tx) => owedOnce(tx, userId));
}

async function serverRead(
	userId: string,
	ids: readonly string[],
	narrowing: Record<string, string> = {},
): Promise<Read> {
	return userTransaction(adminDb, userId, async (tx) => {
		const pass = new FigurePass();
		const readings = await readFiguresIn(
			tx,
			ids.map((id) => figures.get(id)),
			{ ...narrowing, userId },
			pass,
		);
		return {
			readings,
			missing: new Map(ids.map((id) => [id, pass.missingRates(id)])),
		};
	});
}

async function deviceRead(
	userId: string,
	ids: readonly string[],
	narrowing: Record<string, string> = {},
): Promise<Read> {
	const store = await engineStoreOf(userId);
	const owed = await owedOf(userId);
	const registry = deviceFigures({ owed: () => owed });
	const pass = new FigurePass();
	const readings = await readFiguresIn(
		store,
		ids.map((id) => registry.get(id)),
		{ ...narrowing, userId },
		pass,
	);
	return {
		readings,
		missing: new Map(ids.map((id) => [id, pass.missingRates(id)])),
	};
}

/** Every id equal on both sides, with the id in the failure message. */
function expectSame(device: Read, server: Read, ids: readonly string[]) {
	for (const id of ids) {
		expect(device.readings.get(id), `${id} reading`).toEqual(
			server.readings.get(id),
		);
		expect(device.missing.get(id), `${id} missing rates`).toEqual(
			server.missing.get(id),
		);
	}
}

const SCOPELESS = DEVICE_FIGURE_IDS.filter(
	(id) => id !== "recurring.amount" && id !== "accounts.balance",
);

describe("the device registry against the server", () => {
	for (const [name, profile] of Object.entries(PROFILES))
		describe(name, () => {
			const ledger = () => ledgers.get(name) as Ledger;

			it("reads every figure as the server does", async () => {
				const { userId } = ledger();
				const ids = [...SCOPELESS, "accounts.balance"];
				const server = await serverRead(userId, ids);
				expectSame(await deviceRead(userId, ids), server, ids);
				// Not trivially equal because both are null or empty.
				expect(server.readings.get("spent")?.length).toBeGreaterThan(0);
				expect(
					server.readings.get("recurring.cost.out.month"),
				).not.toBeUndefined();
				if (profile.withMissingRate) {
					expect(server.readings.get("glance.spent")).toBeNull();
					expect(server.missing.get("glance.spent")).toEqual(["XQZ"]);
					expect(server.readings.get("netWorth")).toBeNull();
				} else {
					expect(server.readings.get("glance.spent")).not.toBeNull();
				}
			});

			it("reads each template and each account as the server does", async () => {
				const { userId, templateIds, accountIds } = ledger();
				const server = async (id: string, key: string, value: string) =>
					serverRead(userId, [id], { [key]: value });
				const device = async (id: string, key: string, value: string) =>
					deviceRead(userId, [id], { [key]: value });
				for (const t of [...templateIds, "no-such-template"])
					expectSame(
						await device("recurring.amount", "recurringId", t),
						await server("recurring.amount", "recurringId", t),
						["recurring.amount"],
					);
				for (const a of [...accountIds, "no-such-account"])
					expectSame(
						await device("accounts.balance", "accountId", a),
						await server("accounts.balance", "accountId", a),
						["accounts.balance"],
					);
			});

			it("previews expense.create as the server does", async () => {
				const { userId } = ledger();
				const input = {
					id: randomUUID(),
					title: "Books",
					amount: "100",
					currency: "USD",
					date: new Date(NOW.getTime() - 60 * 60 * 1000),
				};
				const store = await engineStoreOf(userId);
				const owed = await owedOf(userId);
				const device = await createDevicePreviewRunner({
					store,
					figures: deviceFigures({ owed: () => owed }),
					actor: { userId },
				}).preview(EXPENSE_CREATE_MUTATION, input);
				const server = await forUser(userId).preview(createExpense, input);
				expect(device.changes).toEqual(server.changes);
				expect(device.unchanged).toEqual(server.unchanged);
				expect(device.unavailable).toEqual(server.unavailable);
				expect(device.approx).toEqual(server.approx);
			});
		});
});

describe("the device registry's shape", () => {
	it("registers a subset of the server's ids with the same scope", () => {
		const server = new Set(figures.ids);
		const device = deviceFigures({ owed: () => ({ owedToYou: 0, youOwe: 0 }) });
		for (const id of device.ids) {
			expect(server.has(id), `${id} is a server figure`).toBe(true);
			expect(device.get(id).scope, `${id} scope`).toEqual(
				figures.get(id).scope,
			);
			expect(device.get(id).inEveryPreview, `${id} inEveryPreview`).toBeFalsy();
		}
		expect([...device.ids].sort()).toEqual([...DEVICE_FIGURE_IDS].sort());
	});

	it("names a reason for every server figure the device lacks", () => {
		for (const id of figures.ids)
			if (!DEVICE_FIGURE_IDS.includes(id))
				expect(serverOnlyReason(id), `${id} needs a reason`).toBeDefined();
	});

	it("touches what the server's expense.create touches", () => {
		expect(EXPENSE_CREATE_MUTATION.touches).toEqual(createExpense.touches);
		expect(EXPENSE_CREATE_MUTATION.id).toBe(createExpense.id);
	});

	// The device matches an unavailable owed reading by `instanceof`; this
	// hands it the server's class, so one class per module is what is held.
	it("shares the FigureUnavailable class with the server", async () => {
		const { userId } = ledgers.get(
			"ARS home, alias zone, official default",
		) as Ledger;
		const store = await engineStoreOf(userId);
		const registry = deviceFigures({
			owed: () => new FigureUnavailable(["BRL"]),
		});
		const pass = new FigurePass();
		const readings = await readFiguresIn(
			store,
			[registry.get("netWorth")],
			{ userId },
			pass,
		);
		expect(readings.get("netWorth")).toBeNull();
		expect(pass.missingRates("netWorth")).toEqual(["BRL"]);
	});
});

describe("by hand: a share with no captured rate", () => {
	// Ana, ARS home in Buenos Aires, October at blue 1,500 (official 1,000
	// loses): ARS 1,000 booked as entered; USD 10 worth USD 10; a JPY 1,500
	// share with no captured rate, priced from the table's JPY 150 on its own
	// day. Spent: ARS 1,000.00, JPY 1,500, USD 10.00, per original currency.
	// Glance.spent in ARS: 1,000 + 10 x 1,500 (15,000) + 1,500 / 150 x 1,500
	// (15,000) = 31,000.00. The server's old default left that share unpriced
	// on a device, so glance would have read unavailable there.
	it("reads the same hand-derived numbers on both sides", async () => {
		const { user } = await createTestUser();
		const { user: bob } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ARS", timeZone: BA },
		});
		const row = (
			amount: string,
			currency: string,
			usd: string,
			booked: boolean,
		) =>
			fixtureDb.expense.create({
				data: {
					id: randomUUID(),
					userId: user.id,
					title: "row",
					amount: D(amount),
					currency,
					date: new Date("2026-10-05T15:00:00Z"),
					amountInUSD: D(usd),
					exchangeRate: D("1500"),
					pricingSource: "MANUAL",
					...(booked
						? {
								homeCurrency: "ARS",
								homeAmount: D(amount),
								homeRate: D("1"),
								rateType: "blue",
							}
						: {}),
				},
			});
		await row("1000", "ARS", "0.67", true);
		await row("10", "USD", "10", false);
		await adminDb.sharedTransaction.create({
			data: {
				description: "dinner",
				amount: D("1500"),
				currency: "JPY",
				date: new Date("2026-10-08T15:00:00Z"),
				paidByType: "user",
				paidById: bob.id,
				createdByType: "user",
				createdById: bob.id,
				splitParticipants: {
					create: {
						participantType: "user",
						participantId: user.id,
						shareAmount: D("1500"),
						verificationStatus: "ACCEPTED",
					},
				},
			},
		});
		const ids = ["spent", "glance.spent"];
		const server = await serverRead(user.id, ids);
		const device = await deviceRead(user.id, ids);
		const spent = [
			{ minor: 100_000, currency: "ARS" },
			{ minor: 1_500, currency: "JPY" },
			{ minor: 1_000, currency: "USD" },
		];
		const glance = [{ minor: 3_100_000, currency: "ARS" }];
		for (const side of [server, device]) {
			expect(side.readings.get("spent")).toEqual(spent);
			expect(side.readings.get("glance.spent")).toEqual(glance);
		}
	});
});
