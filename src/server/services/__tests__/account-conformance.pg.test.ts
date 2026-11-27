/**
 * The engine's account vectors (packages/engine/src/account-vectors.ts,
 * expected values derived by hand there) against the server, on a real
 * Postgres. Each step runs through the real v1 route, then the rows are read
 * back as a device store (src/test/engine-store.ts) and held to the hand-derived
 * values; the same step runs through the engine on the store as it was before
 * the route, and the two stores must be equal row by row on every field the
 * engine keeps: accounts, legs, snapshots and rate switches (the version
 * included, the engine's being a placeholder that follows the same trigger
 * rule), then the net worth, the touched accounts' balances and the change
 * parts must read the same on both sides. A refusal must carry the engine's
 * words and write nothing; a rate neither side has is a 400 on the server and
 * a MissingRateError on the device. The snapshot's USD value (which only the
 * server keeps) is held to the vector's hand value too.
 *
 * The process zone is not the saved zone, so a server that read its own zone
 * would date a snapshot or a leg another day. Rates are global and a case needs
 * exactly its seed, so each reset replaces the table; the rows other files left
 * in this worker's database are put back after.
 */

import { noRateFound } from "@retrospend/domain/accounts/refusals";
import { MissingRateError } from "@retrospend/domain/money";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	setRateTypeMutation,
	updateBalanceMutation,
} from "~/server/services/api-v1/accounts/balance";
import {
	closeAccountMutation,
	createAccountMutation,
	reopenAccountMutation,
	updateAccountMutation,
} from "~/server/services/api-v1/accounts/mutations";
import { engineStoreOf } from "~/test/engine-store";
import { deviceReadFrom, expectSame, serverRead } from "~/test/parity/compare";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import {
	checkState,
	differingRows,
} from "../../../../packages/engine/src/account-conformance";
import {
	ACCOUNT_CLOSE_MUTATION,
	ACCOUNT_CREATE_MUTATION,
	ACCOUNT_REOPEN_MUTATION,
	ACCOUNT_SET_RATE_TYPE_MUTATION,
	ACCOUNT_UPDATE_BALANCE_MUTATION,
	ACCOUNT_UPDATE_MUTATION,
} from "../../../../packages/engine/src/account-mutations";
import {
	type AccountStep,
	type AccountVector,
	accountVectors,
} from "../../../../packages/engine/src/account-vectors";
import { planOf } from "../../../../packages/engine/src/device/book";
import { LocalDb } from "../../../../packages/engine/src/local-db";
import { type V1, v1For } from "./recurring-write-kit";

declare const process: { env: Record<string, string | undefined> };
const originalTZ = process.env.TZ;
let others: Prisma.ExchangeRateCreateManyInput[] = [];

beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
});

afterEach(() => {
	vi.useRealTimers();
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

interface Sent {
	method: string;
	path: string;
	body: object;
}

/** The v1 request an op is. The bodies are the engine's: the same fields the route takes. */
function requestOf(op: AccountStep["op"]): Sent {
	const { id } = op.body;
	switch (op.kind) {
		case "accountCreate":
			return { method: "POST", path: "/accounts", body: op.body };
		case "accountUpdate":
			return { method: "PUT", path: `/accounts/${id}`, body: op.body };
		case "accountClose":
			return { method: "POST", path: `/accounts/${id}/close`, body: { id } };
		case "accountReopen":
			return { method: "POST", path: `/accounts/${id}/reopen`, body: { id } };
		case "accountBalance":
			return { method: "POST", path: `/accounts/${id}/balance`, body: op.body };
		case "accountRateType":
			return {
				method: "POST",
				path: `/accounts/${id}/rate-type`,
				body: op.body,
			};
	}
}

/**
 * The words a refusal carries: the problem's detail (the service's message),
 * or, for a body the schema refuses, the first issue the answer lists.
 */
async function detailOf(res: Response) {
	const text = await res.text();
	const body = JSON.parse(text) as {
		detail?: string;
		code?: string;
		errors?: { message: string }[];
	};
	return {
		status: res.status,
		code: body.code,
		detail: body.detail ?? body.errors?.[0]?.message,
		text,
	};
}

async function seedServer(vector: AccountVector) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: vector.seed.homeCurrency,
			timeZone: vector.seed.timeZone,
			defaultRateTypes: vector.seed.defaultRateTypes ?? {},
		},
	});
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({
		data: vector.seed.rates.map((r) => ({
			currency: r.currency,
			type: r.type,
			rate: r.rate,
			date: r.date,
		})),
	});
	for (const a of vector.accounts ?? [])
		await fixtureDb.assetAccount.create({
			data: {
				id: a.id,
				userId: user.id,
				name: a.name,
				type: a.type as Prisma.AssetAccountCreateInput["type"],
				currency: a.currency,
				balance: a.balance,
				exchangeRate: a.exchangeRate,
				exchangeRateType: a.exchangeRateType,
				countedUnits: a.countedUnits ?? "0",
				closedAt: a.closedAt ?? null,
				createdAt: new Date("2026-10-01T00:00:00Z"),
			},
		});
	return user.id;
}

/** The snapshot USD values the vector derived by hand; the device keeps none. */
async function expectUsd(userId: string, step: AccountStep) {
	if (!("done" in step.expect)) return;
	for (const s of step.expect.done.snapshots ?? []) {
		if (s.usd === undefined) continue;
		const row = await fixtureDb.assetSnapshot.findFirstOrThrow({
			where: {
				userId,
				accountId: s.accountId,
				date: new Date(`${s.day}T00:00:00.000Z`),
			},
		});
		expect(
			row.balanceInUSD.toFixed(2),
			`usd of ${s.accountId} on ${s.day}`,
		).toBe(s.usd);
	}
}

/** Net worth, each account's balance and the change parts, read on both sides at `now`. */
async function expectFiguresSame(
	userId: string,
	store: Awaited<ReturnType<typeof engineStoreOf>>,
	now: Date,
) {
	const ids = [
		"netWorth",
		"netWorthChange.opened",
		"netWorthChange.closed",
		"netWorthChange.revaluation",
		"netWorthChange.notLogged",
	];
	expectSame(
		await deviceReadFrom(store, userId, ids, {}, () => now),
		await serverRead(userId, ids),
		ids,
	);
	for (const account of store.list("accounts")) {
		const narrowing = { accountId: account.id };
		expectSame(
			await deviceReadFrom(
				store,
				userId,
				["accounts.balance"],
				narrowing,
				() => now,
			),
			await serverRead(userId, ["accounts.balance"], narrowing),
			["accounts.balance"],
		);
	}
}

async function runVector(vector: AccountVector) {
	process.env.TZ = "Pacific/Auckland";
	const userId = await seedServer(vector);
	const v1: V1 = await v1For(userId);
	for (const step of vector.steps) {
		const now = new Date(step.now);
		const device = await engineStoreOf(userId);
		const { id, write } = planOf(step.op, device.snapshot(), {}, now);
		const sent = requestOf(step.op);
		vi.useFakeTimers({ toFake: ["Date"], now });
		try {
			const res = await v1(sent.method, sent.path, sent.body);
			const want = step.expect;
			const after = await engineStoreOf(userId);
			if ("done" in want) {
				expect(res.status, await res.clone().text()).toBeLessThan(300);
				await checkState(after, want.done, now);
				await expectUsd(userId, step);
				await new LocalDb(device).write(id, write);
				expect(differingRows(device, after)).toEqual([]);
				await expectFiguresSame(userId, device, now);
				continue;
			}
			const failed = await detailOf(res);
			expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
			// A refusal writes nothing.
			expect(differingRows(await engineStoreOf(userId), after)).toEqual([]);
			const error = await new LocalDb(device)
				.write(id, write)
				.catch((e: unknown) => e);
			if ("refused" in want) {
				expect(failed.detail).toBe(want.refused);
				expect((error as Error).message).toBe(want.refused);
			} else {
				const [currency] = want.missingRate;
				expect(error).toBeInstanceOf(MissingRateError);
				expect((error as MissingRateError).currencies).toEqual(
					want.missingRate,
				);
				// The server's refusal: a create names the rate in its words, a reopen is the typed missing rate.
				expect(
					failed.code === "missing_rate" ||
						failed.detail === noRateFound(currency as string),
					failed.text,
				).toBe(true);
			}
			expect(differingRows(device, after)).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	}
}

describe("account conformance (server and device, real Postgres)", () => {
	for (const vector of accountVectors)
		it(vector.name, () => runVector(vector), 60_000);
});

describe("the device mutations touch what the server's do", () => {
	it.each([
		[ACCOUNT_CREATE_MUTATION, createAccountMutation],
		[ACCOUNT_UPDATE_MUTATION, updateAccountMutation],
		[ACCOUNT_CLOSE_MUTATION, closeAccountMutation],
		[ACCOUNT_REOPEN_MUTATION, reopenAccountMutation],
		[ACCOUNT_UPDATE_BALANCE_MUTATION, updateBalanceMutation],
		[ACCOUNT_SET_RATE_TYPE_MUTATION, setRateTypeMutation],
	])("%s", (device, server) => {
		expect(device.id).toBe(server.id);
		expect([...device.touches]).toEqual([...server.touches]);
	});
});
