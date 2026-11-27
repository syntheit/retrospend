/**
 * The account guards of /api/v1/accounts (M6 PR2a): a write that names the
 * `version` it read (and, for Update balance, the stored `balance` it saw) runs
 * only while the account still has them; otherwise 409 account_changed and
 * nothing is written, for the write and its preview twin alike. The answers
 * carry the account's version. USD home, so every value is worked out by hand:
 * a balance of 1000 is stored 1000.00000000 and "1000" must equal it.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
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
type Item = { id: string; version: number; closedAt: string | null };
type Write = { result: Record<string, unknown>; undo: string | null };

describe("account_changed", () => {
	let as: Record<string, string>;
	let userId: string;

	const send = (method: string, path: string, body?: unknown) =>
		call(path, {
			method,
			headers: { ...as, "x-forwarded-for": "198.51.100.93" },
			body,
			idempotent: method !== "GET",
		});
	const open = async (over: Record<string, unknown> = {}) => {
		const body = {
			id: randomUUID(),
			name: "Wise",
			type: "CASH",
			currency: "USD",
			balance: "1000",
			...over,
		};
		const made = await expectBody<Write>(
			await send("POST", "/accounts", body),
			c.create,
			201,
		);
		return { body, made: made.result as unknown as Item };
	};
	const row = (id: string) =>
		fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });
	const legs = (id: string) =>
		adminDb.accountLeg.count({ where: { accountId: id } });
	const move = (from: string, to: string, amount: string) =>
		forUser(userId).apply(createTransfer, {
			fromAccountId: from,
			toAccountId: to,
			fromAmount: amount,
		});

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await sessionHeaders(userId);
	});

	it("a new account answers version 0, the list and the account read agree, and a rate type change answers the next", async () => {
		const { body, made } = await open();
		expect(made.version).toBe(0);
		const read = await expectBody<Item>(
			await call(`/accounts/${body.id}`, {
				headers: { ...as, "x-forwarded-for": "198.51.100.93" },
			}),
			c.get,
		);
		expect(read.version).toBe(0);
		const set = await expectBody<Write>(
			await send("POST", `/accounts/${body.id}/rate-type`, {
				id: body.id,
				rateType: "blue",
			}),
			c.setRateType,
		);
		expect(set.result.version).toBe(1);
		expect((await row(body.id)).version).toBe(1);
	});

	describe("update", () => {
		it("a stale version answers 409 and writes nothing, a current one writes and answers the next version", async () => {
			const { body } = await open({ name: "Before" });
			await send("POST", `/accounts/${body.id}/rate-type`, {
				id: body.id,
				rateType: "blue",
			});
			const next = { ...body, name: "After", isLiquid: true };
			await expectProblem(
				await send("PUT", `/accounts/${body.id}`, {
					...next,
					expectedVersion: 0,
				}),
				409,
				"account_changed",
			);
			expect((await row(body.id)).isLiquid).toBe(false);
			const done = await expectBody<Write>(
				await send("PUT", `/accounts/${body.id}`, {
					...next,
					expectedVersion: 1,
				}),
				c.update,
			);
			expect(done.result.version).toBe(2);
			expect((await row(body.id)).isLiquid).toBe(true);
		});

		it("the preview twin refuses a stale version too", async () => {
			const { body } = await open();
			await send("POST", `/accounts/${body.id}/rate-type`, {
				id: body.id,
				rateType: "blue",
			});
			await expectProblem(
				await send("POST", `/accounts/${body.id}/preview`, {
					...body,
					expectedVersion: 0,
				}),
				409,
				"account_changed",
			);
		});

		it("a transfer or an income leg in between does not spoil the version", async () => {
			const a = await open({ name: "A" });
			const b = await open({ name: "B" });
			await move(a.body.id, b.body.id, "100");
			const done = await expectBody<Write>(
				await send("PUT", `/accounts/${a.body.id}`, {
					...a.body,
					isLiquid: true,
					expectedVersion: 0,
				}),
				c.update,
			);
			expect(done.result.version).toBe(1);
		});

		it("without expectedVersion nothing is checked", async () => {
			const { body } = await open();
			await send("POST", `/accounts/${body.id}/rate-type`, {
				id: body.id,
				rateType: "blue",
			});
			await expectBody(
				await send("PUT", `/accounts/${body.id}`, { ...body, isLiquid: true }),
				c.update,
			);
		});
	});

	describe("close and reopen", () => {
		it("a stale version answers 409 and leaves the account as it was; the current one closes and reopens it", async () => {
			const { body } = await open();
			await expectProblem(
				await send("POST", `/accounts/${body.id}/close`, {
					id: body.id,
					expectedVersion: 5,
				}),
				409,
				"account_changed",
			);
			expect((await row(body.id)).closedAt).toBeNull();
			const closed = await expectBody<Write>(
				await send("POST", `/accounts/${body.id}/close`, {
					id: body.id,
					expectedVersion: 0,
				}),
				c.close,
			);
			expect(closed.result.version).toBe(1);
			await expectProblem(
				await send("POST", `/accounts/${body.id}/reopen`, {
					id: body.id,
					expectedVersion: 0,
				}),
				409,
				"account_changed",
			);
			expect((await row(body.id)).closedAt).not.toBeNull();
			const reopened = await expectBody<Write>(
				await send("POST", `/accounts/${body.id}/reopen`, {
					id: body.id,
					expectedVersion: 1,
				}),
				c.reopen,
			);
			expect(reopened.result.version).toBe(2);
		});

		it("the previews refuse a stale version", async () => {
			const { body } = await open();
			for (const action of ["close", "reopen"])
				await expectProblem(
					await send("POST", `/accounts/${body.id}/${action}/preview`, {
						id: body.id,
						expectedVersion: 9,
					}),
					409,
					"account_changed",
				);
		});
	});

	describe("rate type", () => {
		it("a stale version answers 409 with no switch written; a transfer in between does not spoil a pending change", async () => {
			const a = await open({ name: "A" });
			const b = await open({ name: "B" });
			await move(a.body.id, b.body.id, "10");
			const switches = () =>
				adminDb.assetRateType.count({ where: { accountId: a.body.id } });
			const before = await switches();
			await expectProblem(
				await send("POST", `/accounts/${a.body.id}/rate-type`, {
					id: a.body.id,
					rateType: "blue",
					expectedVersion: 3,
				}),
				409,
				"account_changed",
			);
			expect(await switches()).toBe(before);
			const done = await expectBody<Write>(
				await send("POST", `/accounts/${a.body.id}/rate-type`, {
					id: a.body.id,
					rateType: "blue",
					expectedVersion: 0,
				}),
				c.setRateType,
			);
			expect(done.result.version).toBe(1);
			await expectProblem(
				await send("POST", `/accounts/${a.body.id}/rate-type/preview`, {
					id: a.body.id,
					rateType: "official",
					expectedVersion: 0,
				}),
				409,
				"account_changed",
			);
		});
	});

	describe("balance", () => {
		it("expectedBalance is compared as a number: 1000 equals the stored 1000.00000000", async () => {
			const { body } = await open({ balance: "1000" });
			const done = await expectBody<Write>(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "1200",
					expectedBalance: "1000",
				}),
				c.updateBalance,
			);
			expect(done.result).toMatchObject({ version: 0 });
			expect((await row(body.id)).balance.toString()).toBe("1200");
			// "1200.0" and "1200.00000000" are the same number too.
			for (const same of ["1200.0", "1200.00000000"])
				await expectBody(
					await send("POST", `/accounts/${body.id}/balance`, {
						id: body.id,
						balance: "1200",
						expectedBalance: same,
					}),
					c.updateBalance,
				);
		});

		it("a balance that moved answers 409 and writes no leg and no balance", async () => {
			const a = await open({ name: "A" });
			const b = await open({ name: "B" });
			await move(a.body.id, b.body.id, "100");
			const legsBefore = await legs(a.body.id);
			await expectProblem(
				await send("POST", `/accounts/${a.body.id}/balance`, {
					id: a.body.id,
					balance: "5000",
					expectedBalance: "1000",
				}),
				409,
				"account_changed",
			);
			expect((await row(a.body.id)).balance.toString()).toBe("900");
			expect(await legs(a.body.id)).toBe(legsBefore);
			await expectProblem(
				await send("POST", `/accounts/${a.body.id}/balance/preview`, {
					id: a.body.id,
					balance: "5000",
					expectedBalance: "1000",
				}),
				409,
				"account_changed",
			);
		});

		it("a liability is compared by its stored balance, the owed amount as a positive number", async () => {
			const { body } = await open({
				name: "Card",
				type: "LIABILITY_CREDIT_CARD",
				balance: "500",
			});
			expect((await row(body.id)).balance.toString()).toBe("500");
			await expectProblem(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "400",
					expectedBalance: "-500",
				}),
				409,
				"account_changed",
			);
			await expectBody(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "400",
					expectedBalance: "500",
				}),
				c.updateBalance,
			);
			expect((await row(body.id)).balance.toString()).toBe("400");
		});

		it("expectedVersion on a balance update is checked with the balance, and the answer carries the version", async () => {
			const { body } = await open();
			await send("POST", `/accounts/${body.id}/rate-type`, {
				id: body.id,
				rateType: "blue",
			});
			await expectProblem(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "1100",
					expectedBalance: "1000",
					expectedVersion: 0,
				}),
				409,
				"account_changed",
			);
			const done = await expectBody<Write>(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "1100",
					expectedBalance: "1000",
					expectedVersion: 1,
				}),
				c.updateBalance,
			);
			expect(done.result.version).toBe(1);
		});

		it("a version alone is not spoiled by a leg, and a balance alone is not spoiled by a rate type change", async () => {
			const a = await open({ name: "A" });
			const b = await open({ name: "B" });
			await move(a.body.id, b.body.id, "100");
			await expectBody(
				await send("POST", `/accounts/${a.body.id}/balance`, {
					id: a.body.id,
					balance: "950",
					expectedVersion: 0,
				}),
				c.updateBalance,
			);
			await send("POST", `/accounts/${b.body.id}/rate-type`, {
				id: b.body.id,
				rateType: "blue",
			});
			await expectBody(
				await send("POST", `/accounts/${b.body.id}/balance`, {
					id: b.body.id,
					balance: "1200",
					expectedBalance: "1100",
				}),
				c.updateBalance,
			);
		});

		it("the undo of a balance update answers the account's version", async () => {
			const { body } = await open();
			const done = await expectBody<Write>(
				await send("POST", `/accounts/${body.id}/balance`, {
					id: body.id,
					balance: "1100",
				}),
				c.updateBalance,
			);
			const undone = await expectBody<{
				result: { kind: string; result: { version: number } };
			}>(await send("POST", "/accounts/undo", { token: done.undo }), c.undo);
			expect(undone.result.kind).toBe("balance.revert");
			expect(undone.result.result.version).toBe(0);
		});
	});

	it("two writes that name the same version: one wins, the other is account_changed", async () => {
		const { body } = await open();
		const results = await Promise.all(
			[true, false].map((isLiquid) =>
				send("PUT", `/accounts/${body.id}`, {
					...body,
					isLiquid,
					interestRate: isLiquid ? "1.5" : "2.5",
					expectedVersion: 0,
				}),
			),
		);
		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		expect((await row(body.id)).version).toBe(1);
	});

	it("another person's account is not found, with or without a version", async () => {
		const other = await sessionHeaders((await createTestUser()).user.id);
		const { body } = await open();
		await expectProblem(
			await call(`/accounts/${body.id}/close`, {
				method: "POST",
				headers: { ...other, "x-forwarded-for": "198.51.100.93" },
				body: { id: body.id, expectedVersion: 0 },
				idempotent: true,
			}),
			404,
			"not_found",
		);
	});
});
