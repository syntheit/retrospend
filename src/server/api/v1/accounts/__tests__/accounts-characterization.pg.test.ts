/**
 * M6 PR0: the v1 account writes as they behave today. USD home and the real
 * clock, so every value is hand-derived without a rate: the snapshot of a USD
 * account is its balance. Pinned: one snapshot per account per day (a second
 * write the same day replaces it), close and reopen of an account already in
 * that state succeed and change nothing, a delete then a restore gives back
 * the stored updatedAt and balance, and the refusals once legs exist.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	call,
	expectBody,
	expectProblem,
	asMobile as sessionHeaders,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.accounts;
type Money = { minor: number; currency: string };
type Item = { id: string; balance: Money; closedAt: string | null };
type Write = { result: Record<string, unknown>; undo: string | null };

describe("/api/v1/accounts, as they behave today", () => {
	let userId: string;
	let as: Record<string, string>;
	let stranger: Record<string, string>;

	const send = (method: string, path: string, body?: unknown, headers = as) =>
		call(path, { method, headers, body, idempotent: method !== "GET" });
	const open = async (name: string, balance = "100", extra = {}) => {
		const id = randomUUID();
		await expectBody(
			await send("POST", "/accounts", {
				id,
				name,
				type: "CASH",
				currency: "USD",
				balance,
				...extra,
			}),
			c.create,
			201,
		);
		return id;
	};
	const row = (id: string) =>
		fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });
	const snapshots = (id: string) =>
		adminDb.assetSnapshot.findMany({
			where: { accountId: id },
			orderBy: { date: "asc" },
		});
	const history = (id: string) =>
		adminDb.assetHistory.count({ where: { assetId: id } });
	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = {
			...(await sessionHeaders(userId)),
			"x-forwarded-for": "198.51.100.91",
		};
		stranger = {
			...(await sessionHeaders((await createTestUser()).user.id)),
			"x-forwarded-for": "198.51.100.92",
		};
	});

	it("keeps one snapshot a day: a second balance write replaces it, and every write adds a history entry", async () => {
		const id = await open("Checking", "100");
		expect(await snapshots(id)).toHaveLength(1);
		for (const balance of ["120", "135.50"]) {
			await expectBody(
				await send("POST", `/accounts/${id}/balance`, { balance }),
				c.updateBalance,
			);
		}
		const [only, ...rest] = await snapshots(id);
		expect(rest).toEqual([]);
		expect([only?.balance.toString(), only?.balanceInUSD.toString()]).toEqual([
			"135.5",
			"135.5",
		]);
		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: id },
			orderBy: { amount: "asc" },
		});
		expect(legs.map((l) => [l.source, l.amount.toString()])).toEqual([
			["BALANCE_UPDATE", "15.5"],
			["BALANCE_UPDATE", "20"],
		]);
		expect(await history(id)).toBe(3);
	});

	it("a rate type switch writes a dated row and keeps the type on the account", async () => {
		const id = await open("Brokerage", "100", { rateType: "official" });
		const switched = await expectBody<Write>(
			await send("POST", `/accounts/${id}/rate-type`, { rateType: "blue" }),
			c.setRateType,
		);
		expect(switched.result).toMatchObject({
			rateType: "blue",
			earlier: "official",
		});
		expect((await row(id)).exchangeRateType).toBe("blue");
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(1);
		// A switch alone writes no snapshot and no leg.
		expect(await snapshots(id)).toHaveLength(1);
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
	});

	it("closing a closed account and reopening an open one answer 200 and change nothing", async () => {
		const id = await open("Spare", "5");
		const openRow = await row(id);
		const openSnapshots = await snapshots(id);
		await wait(15);
		const reopened = await expectBody<Write & { result: Item }>(
			await send("POST", `/accounts/${id}/reopen`, { id }),
			c.reopen,
		);
		expect(reopened.result.closedAt).toBeNull();
		expect(await row(id)).toEqual(openRow);
		expect(await snapshots(id)).toEqual(openSnapshots);

		await expectBody(
			await send("POST", `/accounts/${id}/close`, { id }),
			c.close,
		);
		const closedRow = await row(id);
		const closedSnapshots = await snapshots(id);
		const closedHistory = await history(id);
		await wait(15);
		const again = await expectBody<Write & { result: Item }>(
			await send("POST", `/accounts/${id}/close`, { id }),
			c.close,
		);
		expect(again.result.closedAt).toEqual(expect.any(String));
		expect(await row(id)).toEqual(closedRow);
		expect(await snapshots(id)).toEqual(closedSnapshots);
		expect(await history(id)).toBe(closedHistory);
		// Close and reopen the same day leave one snapshot for the day.
		await expectBody(
			await send("POST", `/accounts/${id}/reopen`, { id }),
			c.reopen,
		);
		expect(await snapshots(id)).toHaveLength(closedSnapshots.length);
	});

	it("a delete then its restore give back the balance, the stored updatedAt and the history", async () => {
		const id = await open("Wise", "100");
		await expectBody(
			await send("POST", `/accounts/${id}/balance`, { balance: "130" }),
			c.updateBalance,
		);
		const before = await row(id);
		const legs = await adminDb.accountLeg.count({ where: { accountId: id } });
		const snaps = await snapshots(id);
		await wait(15);

		const deleted = await expectBody<Write>(
			await send("POST", `/accounts/${id}/delete`, { id }),
			c.delete,
		);
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(0);
		await wait(15);
		await expectBody<{ kind: string; result: Item }>(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			c.undo,
		);

		const after = await row(id);
		expect(after.balance.toString()).toBe("130");
		expect(after.updatedAt).toEqual(before.updatedAt);
		expect(after.createdAt).toEqual(before.createdAt);
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			legs,
		);
		expect(await snapshots(id)).toEqual(snaps);
		await expectProblem(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			409,
			"conflict",
		);
	});

	it("once legs exist the currency cannot change, and a closed account takes no balance write", async () => {
		const id = await open("Euro box", "100");
		await expectBody(
			await send("POST", `/accounts/${id}/balance`, { balance: "110" }),
			c.updateBalance,
		);
		const fields = {
			id,
			name: "Euro box",
			type: "CASH",
			currency: "EUR",
			balance: "110",
		};
		await expectProblem(
			await send("PUT", `/accounts/${id}`, fields),
			400,
			"bad_request",
		);
		expect((await row(id)).currency).toBe("USD");

		await expectBody(
			await send("POST", `/accounts/${id}/close`, { id }),
			c.close,
		);
		await expectProblem(
			await send("POST", `/accounts/${id}/balance`, { balance: "1" }),
			400,
			"bad_request",
		);
		expect((await row(id)).balance.toString()).toBe("110");
	});

	it("another person's account is a 404 on every write", async () => {
		const id = await open("Private", "10");
		for (const [path, body] of [
			[`/accounts/${id}/balance`, { balance: "1" }],
			[`/accounts/${id}/close`, { id }],
			[`/accounts/${id}/reopen`, { id }],
			[`/accounts/${id}/delete`, { id }],
			[`/accounts/${id}/rate-type`, { rateType: "blue" }],
		] as const) {
			await expectProblem(
				await send("POST", path, body, stranger),
				404,
				"not_found",
			);
		}
		expect((await row(id)).balance.toString()).toBe("10");
	});
});
