/**
 * The phone's wire for a queued account write (@retrospend/api-client wealth-wire.ts) over
 * the real v1 routes: what the device booked over a pull is sent with the
 * version and the stored balance it saw, the answer's version is the account's
 * own (the device never counts the server's), and a fresh pull holds the
 * booked rows equal under the compare the phone runs on an acked write
 * (write-parity.ts `compareEntry`). A stale version, and a balance that moved
 * without a version bump, are 409 account_changed with nothing written.
 * ARS home at blue 1,545 and official 1,050 from three days back, USD account
 * of 1,000, zone Buenos Aires. Hand-derived:
 *   balance 1,000 to 1,200: Not logged leg +200, home 200 x 1,545 = 309,000;
 *   an edit that changes isLiquid and the rate type writes the account twice
 *   (version +2), and a balance update at the same type writes it once (+0).
 */
import { randomUUID } from "node:crypto";
import type { RetrospendClient } from "@retrospend/api-client";
import { dispatchWealth } from "@retrospend/api-client/wealth-wire";
import { contract } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import {
	expectedCounts,
	newDevice,
	pullAll,
	rotatingClient,
} from "~/test/parity/pull";
import { adminDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { BUDGET_GATE_ENTITIES } from "../../../../packages/engine/src/budget-gate";
import {
	type BookedWrite,
	bookIn,
	isDeviceRefusal,
	type WriteOp,
} from "../../../../packages/engine/src/device/book";
import { readOverlaid } from "../../../../packages/engine/src/device/pending";
import type { MemoryStore } from "../../../../packages/engine/src/memory-store";
import { compareEntry } from "../../../../packages/engine/src/write-parity";
import { arsUser, setRates, v1For } from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

let others: Prisma.ExchangeRateCreateManyInput[] = [];

beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
	const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
	await setRates([
		[day, "ARS", "blue", "1545"],
		[day, "ARS", "official", "1050"],
	]);
	await adminDb.exchangeRate.updateMany({
		data: { updatedAt: new Date("2026-01-01T00:00:00.000Z") },
	});
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

const sealed = { bytes: undefined, keep: async () => undefined };
const optionsFor = (key: string) =>
	({
		context: { idempotencyKey: key },
		signal: new AbortController().signal,
		sealed,
	}) as never;

/** A user with a USD account of 1,000 at blue, and the client the phone sends with. */
async function world() {
	const me = await arsUser();
	const v1 = await v1For(me);
	const id = randomUUID();
	await expectBody(
		await v1("POST", "/accounts", {
			id,
			name: "Wise",
			type: "CASH",
			currency: "USD",
			balance: "1000",
			rateType: "blue",
			isLiquid: false,
		}),
		contract.accounts.create,
		201,
	);
	return { me, v1, id, api: rotatingClient(me) as RetrospendClient };
}

async function pulled(me: string): Promise<MemoryStore> {
	const device = await newDevice(me);
	await pullAll(device, await expectedCounts(me), { shares: false });
	return device.store;
}

/** The device books `op` over a pull, as the phone does (nothing is kept), and wraps it as an outbox entry. */
async function queued(
	store: MemoryStore,
	kind: "update" | "balance" | "create",
	op: WriteOp,
	targetId: string,
) {
	const bookedAt = Date.now();
	const booked: BookedWrite = await readOverlaid(store, [], 0, (tx) =>
		bookIn(tx, op, {}, bookedAt),
	);
	const body = (op as unknown as { body: Record<string, unknown> }).body;
	const entry = {
		clientId: randomUUID(),
		entity: "accounts",
		kind,
		targetId,
		baseVersion: booked.accountBase ? String(booked.accountBase.version) : null,
		payload:
			kind === "update" || kind === "balance"
				? { ...body, expectedBalance: booked.accountBase?.balance }
				: body,
	};
	return { booked, entry: entry as never };
}

const accountRow = (id: string) =>
	adminDb.assetAccount.findUniqueOrThrow({ where: { id } });

const balanceOp = (id: string, balance: string): WriteOp => ({
	kind: "accountBalance",
	body: { id, balance, legId: randomUUID(), rateTypeId: randomUUID() },
});

describe("an account write sent over the real routes", () => {
	it("a balance update names the version and balance it saw, adopts the answered version, and compares equal after a pull", async () => {
		const { me, id, api } = await world();
		const store = await pulled(me);
		const legId = randomUUID();
		const { booked, entry } = await queued(
			store,
			"balance",
			{
				kind: "accountBalance",
				body: { id, balance: "1200", legId, rateTypeId: randomUUID() },
			},
			id,
		);
		const sent = await dispatchWealth(api, entry, optionsFor("k-balance"));
		const row = await accountRow(id);
		expect(row.balance.toString()).toBe("1200");
		expect(sent.version).toBe(String(row.version));
		const leg = await adminDb.accountLeg.findUniqueOrThrow({
			where: { id: legId },
		});
		expect(leg.amount.toString()).toBe("200");
		expect(leg.homeAmount?.toString()).toBe("309000");
		const live = await pulled(me);
		const verdicts = compareEntry(live.snapshot(), booked.changes, {
			bookedAt: booked.bookedAt,
			version: sent.version ?? null,
		});
		expect(verdicts.map((v) => v.outcome)).toEqual(["match", "match"]);
	});

	it("an edit that changes isLiquid and the rate type answers a version two above: the answer's, not the device's count", async () => {
		const { me, id, api } = await world();
		const store = await pulled(me);
		const { booked, entry } = await queued(
			store,
			"update",
			{
				kind: "accountUpdate",
				body: {
					id,
					name: "Wise",
					type: "CASH",
					currency: "USD",
					balance: "1000",
					rateType: "official",
					isLiquid: true,
					legId: randomUUID(),
					rateTypeId: randomUUID(),
				},
			},
			id,
		);
		const before = booked.accountBase?.version ?? -1;
		const sent = await dispatchWealth(api, entry, optionsFor("k-edit"));
		expect(sent.version).toBe(String(before + 2));
		expect(String((await accountRow(id)).version)).toBe(sent.version);
		const live = await pulled(me);
		const verdicts = compareEntry(live.snapshot(), booked.changes, {
			bookedAt: booked.bookedAt,
			version: sent.version ?? null,
		});
		expect(verdicts.length).toBeGreaterThan(0);
		expect(verdicts.every((v) => v.outcome === "match")).toBe(true);
	});

	it("a new account goes out under its own id and compares equal", async () => {
		const me = await arsUser();
		const api = rotatingClient(me);
		const store = await pulled(me);
		const id = randomUUID();
		const { booked, entry } = await queued(
			store,
			"create",
			{
				kind: "accountCreate",
				body: {
					id,
					name: "Cash",
					type: "CASH",
					currency: "ARS",
					balance: "500",
					isLiquid: true,
				},
			},
			id,
		);
		const sent = await dispatchWealth(api, entry, optionsFor("k-create"));
		expect(sent.version).toBe("0");
		const live = await pulled(me);
		const verdicts = compareEntry(live.snapshot(), booked.changes, {
			bookedAt: booked.bookedAt,
			version: sent.version ?? null,
		});
		expect(verdicts.map((v) => v.id)).toContain(id);
		expect(verdicts.map((v) => v.outcome)).not.toContain("differs");
	});
});

describe("a write against an account that moved is refused and writes nothing", () => {
	const problem = (error: unknown) =>
		error as { status?: number; code?: string };

	it("another device's edit moved the version: 409 account_changed", async () => {
		const { me, v1, id, api } = await world();
		const store = await pulled(me);
		const { entry } = await queued(store, "balance", balanceOp(id, "1200"), id);
		// Another device switches the rate type: the version moves.
		await expectBody(
			await v1("POST", `/accounts/${id}/rate-type`, {
				id,
				rateType: "official",
			}),
			contract.accounts.setRateType,
		);
		const error = await dispatchWealth(api, entry, optionsFor("k-stale")).catch(
			problem,
		);
		expect(error).toMatchObject({ status: 409, code: "account_changed" });
		expect((await accountRow(id)).balance.toString()).toBe("1000");
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
	});

	it("a balance that moved without a version bump is refused too", async () => {
		const { me, v1, id, api } = await world();
		const store = await pulled(me);
		const { entry } = await queued(store, "balance", balanceOp(id, "1200"), id);
		const before = (await accountRow(id)).version;
		await expectBody(
			await v1("POST", `/accounts/${id}/balance`, { id, balance: "1100" }),
			contract.accounts.updateBalance,
		);
		expect((await accountRow(id)).version).toBe(before);
		const error = await dispatchWealth(
			api,
			entry,
			optionsFor("k-balance-moved"),
		).catch(problem);
		expect(error).toMatchObject({ status: 409, code: "account_changed" });
		expect((await accountRow(id)).balance.toString()).toBe("1100");
	});
});

// ── Transfers: the phone's create goes out as the plain v1 create with the
// ids it booked under, its delete through the wire. ARS home, Just track (no
// budget book) unless a case seeds one. ARS 1,000 moved with a fee of 10:
// the source holds 100,000 - 1,000 - 10 = 98,990 and the destination 51,000.

const network = () => new Error("Network request failed");

async function twoAccounts(me: string) {
	const v1 = await v1For(me);
	const ids = { from: randomUUID(), to: randomUUID() };
	for (const [id, name, balance] of [
		[ids.from, "Checking", "100000"],
		[ids.to, "Savings", "50000"],
	] as const)
		await expectBody(
			await v1("POST", "/accounts", {
				id,
				name,
				type: "CASH",
				currency: "ARS",
				balance,
				isLiquid: true,
			}),
			contract.accounts.create,
			201,
		);
	return ids;
}

const moveBody = (from: string, to: string) => ({
	id: randomUUID(),
	fromLegId: randomUUID(),
	toLegId: randomUUID(),
	feeLegId: randomUUID(),
	feeExpenseId: randomUUID(),
	fromAccountId: from,
	toAccountId: to,
	fromAmount: "1000",
	fee: { amount: "10" },
});

/** The device books a transfer over its pull (nothing is kept), as the phone does. */
async function bookMove(
	device: Awaited<ReturnType<typeof newDevice>>,
	op: WriteOp,
) {
	const bookedAt = Date.now();
	return readOverlaid(device.store, [], 0, (tx) =>
		bookIn(tx, op, device.cursors, bookedAt),
	);
}

async function pulledDevice(me: string) {
	const device = await newDevice(me);
	await pullAll(device, await expectedCounts(me), { shares: false });
	return device;
}

describe("a transfer sent over the real routes", () => {
	it("a create that waited offline is sent with all five ids, and the pulled rows match the device's", async () => {
		const me = await arsUser();
		const api = rotatingClient(me);
		const { from, to } = await twoAccounts(me);
		const device = await pulledDevice(me);
		const body = moveBody(from, to);
		const booked = await bookMove(device, { kind: "transferCreate", body });
		expect(booked.unbooked).toBeUndefined();
		// The first try meets no network; the entry stays and goes out again, same ids, same key.
		let tries = 0;
		const send = async () => {
			if (tries++ === 0) throw network();
			return api.transfers.create(body, optionsFor("k-move"));
		};
		await expect(send()).rejects.toThrow("Network");
		expect(await adminDb.transfer.count({ where: { id: body.id } })).toBe(0);
		await send();
		// The server's rows carry every id the device booked under.
		expect(
			(await adminDb.transfer.findUniqueOrThrow({ where: { id: body.id } }))
				.feeExpenseId,
		).toBe(body.feeExpenseId);
		const legs = await adminDb.accountLeg.findMany({
			where: { transferId: body.id },
			select: { id: true },
		});
		expect(legs.map((l) => l.id).sort()).toEqual(
			[body.fromLegId, body.toLegId, body.feeLegId].sort(),
		);
		expect(
			(
				await adminDb.assetAccount.findUniqueOrThrow({ where: { id: from } })
			).balance.toString(),
		).toBe("98990");
		expect(
			(
				await adminDb.assetAccount.findUniqueOrThrow({ where: { id: to } })
			).balance.toString(),
		).toBe("51000");
		const live = await pulled(me);
		const verdicts = compareEntry(live.snapshot(), booked.changes, {
			bookedAt: booked.bookedAt,
			version: null,
		});
		expect(verdicts.map((v) => v.id)).toEqual(
			expect.arrayContaining([
				body.id,
				body.fromLegId,
				body.toLegId,
				body.feeLegId,
				body.feeExpenseId,
			]),
		);
		expect(verdicts.filter((v) => v.outcome === "differs")).toEqual([]);
	});

	it("a delete is sent and acked, and the pulled store holds none of its rows", async () => {
		const me = await arsUser();
		const api = rotatingClient(me);
		const { from, to } = await twoAccounts(me);
		const body = moveBody(from, to);
		await api.transfers.create(body, optionsFor("k-make"));
		const device = await pulledDevice(me);
		const booked = await bookMove(device, {
			kind: "transferDelete",
			body: { id: body.id },
		});
		const sent = await dispatchWealth(
			api,
			{
				entity: "transfers",
				kind: "delete",
				targetId: body.id,
				baseVersion: null,
				payload: { id: body.id },
			},
			optionsFor("k-delete"),
		);
		expect(sent.undo).not.toBe("");
		expect(await adminDb.transfer.count({ where: { id: body.id } })).toBe(0);
		expect(
			(
				await adminDb.assetAccount.findUniqueOrThrow({ where: { id: from } })
			).balance.toString(),
		).toBe("100000");
		const live = await pulled(me);
		const verdicts = compareEntry(live.snapshot(), booked.changes, {
			bookedAt: booked.bookedAt,
			version: null,
		});
		expect(verdicts.filter((v) => v.outcome === "differs")).toEqual([]);
		expect(verdicts.map((v) => v.id)).toContain(body.id);
	});

	it("a crossing move goes online: the device refuses to book it, nothing is queued, and the server records its budget side", async () => {
		const me = await arsUser();
		const api = rotatingClient(me);
		const v1 = await v1For(me);
		// A book with a default envelope in the home currency: a move out of it has a side to record.
		const book = await adminDb.budgetBook.create({
			data: {
				createdById: me,
				name: "Home",
				currency: "ARS",
				startDate: new Date("2026-11-01T00:00:00.000Z"),
				startMonth: 202611,
			},
		});
		await adminDb.budgetMember.create({
			data: { bookId: book.id, userId: me, role: "OWNER" },
		});
		await adminDb.bookPeriod.create({
			data: {
				bookId: book.id,
				fromMonth: 202611,
				startDay: 1,
				rateType: "blue",
			},
		});
		const envelope = await adminDb.envelope.create({
			data: { bookId: book.id, name: "To assign", sortOrder: 0 },
		});
		await adminDb.budgetBook.update({
			where: { id: book.id },
			data: { defaultEnvelopeId: envelope.id },
		});
		const inside = randomUUID();
		const outside = randomUUID();
		for (const [id, inBudget] of [
			[inside, true],
			[outside, false],
		] as const)
			await expectBody(
				await v1("POST", "/accounts", {
					id,
					name: inBudget ? "Checking" : "Brokerage",
					type: "CASH",
					currency: "ARS",
					balance: "100000",
					isLiquid: true,
					inBudget,
				}),
				contract.accounts.create,
				201,
			);
		const device = await pulledDevice(me);
		const body = {
			...moveBody(inside, outside),
			fee: undefined,
		};
		const refused = await bookMove(device, {
			kind: "transferCreate",
			body,
		}).catch((e: unknown) => e);
		expect(isDeviceRefusal(refused)).toBe(true);
		// Online, the server books it with the side recorded.
		await api.transfers.create(body, optionsFor("k-crossing"));
		expect(
			await adminDb.wealthTransfer.count({ where: { bookId: book.id } }),
		).toBe(1);
	});

	it("a Just track device books locally only once every budget entity is pulled", async () => {
		const me = await arsUser();
		const { from, to } = await twoAccounts(me);
		const device = await pulledDevice(me);
		for (const entity of BUDGET_GATE_ENTITIES)
			expect(device.cursors[entity]).toEqual(expect.any(String));
		const op: WriteOp = {
			kind: "transferCreate",
			body: moveBody(from, to),
		};
		expect((await bookMove(device, op)).changes.length).toBeGreaterThan(0);
		// One entity not pulled yet: a book may not have arrived, so the server decides.
		const behind = {
			...device,
			cursors: { ...device.cursors, budgetBooks: "" },
		};
		const refused = await bookMove(behind as typeof device, op).catch(
			(e: unknown) => e,
		);
		expect(isDeviceRefusal(refused)).toBe(true);
	});
});
