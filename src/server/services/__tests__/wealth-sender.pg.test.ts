/**
 * The phone's wire for a queued account write (apps/mobile sendWealth.ts) over
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
import { dispatchWealth } from "../../../../apps/mobile/src/features/entry/sendWealth";
import {
	type BookedWrite,
	bookIn,
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
	const body = (op as { body: Record<string, unknown> }).body;
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
