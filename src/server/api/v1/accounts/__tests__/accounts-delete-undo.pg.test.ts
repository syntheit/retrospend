/**
 * Deleting a Wealth account on Postgres ends in an Undo (R15). The delete
 * keeps the account and its whole history in the caller's own stash; the token
 * puts back the same account, balance history, legs, rate switches and the
 * moves that pointed at it, exactly as stored. The token is the deleter's
 * alone, works once, and is refused when a move its legs belong to is gone.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
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
type Write = { result: { id: string }; undo: string | null };
type Item = { id: string; balance: { minor: number; currency: string } };

describe("deleting an account is undoable", () => {
	let userId: string;
	let as: Record<string, string>;
	let stranger: Record<string, string>;

	const send = (method: string, path: string, body?: unknown, headers = as) =>
		call(path, {
			method,
			headers: { ...headers, "x-forwarded-for": "198.51.100.89" },
			body,
			idempotent: method !== "GET",
		});
	const open = async (name: string, balance: string, extra = {}) => {
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
	/** Everything the account owns and everything that points at it. */
	const state = async (id: string) => ({
		account: await adminDb.assetAccount.findUnique({ where: { id } }),
		snapshots: await adminDb.assetSnapshot.findMany({
			where: { accountId: id },
			orderBy: { date: "asc" },
		}),
		history: await adminDb.assetHistory.findMany({
			where: { assetId: id },
			orderBy: { id: "asc" },
		}),
		rateTypes: await adminDb.assetRateType.findMany({
			where: { accountId: id },
			orderBy: { id: "asc" },
		}),
		legs: await adminDb.accountLeg.findMany({
			where: { accountId: id },
			orderBy: { id: "asc" },
		}),
		transfers: await adminDb.transfer.findMany({
			where: { OR: [{ fromAccountId: id }, { toAccountId: id }] },
			orderBy: { id: "asc" },
		}),
	});
	const items = async () =>
		(
			await expectBody<{ accounts: Item[] }>(
				await call("/accounts", { headers: as }),
				c.list,
			)
		).accounts;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await sessionHeaders(userId);
		stranger = await sessionHeaders((await createTestUser()).user.id);
	});

	/** An account with a balance update, a move in, a move out and a withdrawal. */
	async function busyAccount() {
		const id = await open("Busy", "100");
		const other = await open("Other", "10");
		await expectBody(
			await send("POST", `/accounts/${id}/balance`, { balance: "150" }),
			c.updateBalance,
		);
		for (const [from, to, amount] of [
			[id, other, "30"],
			[other, id, "5"],
		] as const) {
			const moved = await send("POST", "/transfers", {
				fromAccountId: from,
				toAccountId: to,
				fromAmount: amount,
			});
			expect(moved.status, await moved.clone().text()).toBe(201);
		}
		return { id, other };
	}

	it("puts back the account, its history and the moves that pointed at it, exactly", async () => {
		const { id, other } = await busyAccount();
		const before = await state(id);
		const otherBefore = await state(other);
		expect(before.legs.length).toBeGreaterThan(1);
		expect(before.transfers.length).toBe(2);
		const worth = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});

		const deleted = await expectBody<Write>(
			await send("POST", `/accounts/${id}/delete`, { id }),
			c.delete,
		);
		expect(deleted.undo).toEqual(expect.any(String));
		expect(deleted.result).toEqual({ id });
		expect((await items()).find((a) => a.id === id)).toBeUndefined();
		expect(
			await adminDb.assetSnapshot.count({ where: { accountId: id } }),
		).toBe(0);
		// The moves stay, one side gone.
		expect((await state(id)).transfers).toEqual([]);

		const dry = await expectBody<{ detail?: { kind: string } }>(
			await send("POST", "/accounts/undo/preview", { token: deleted.undo }),
			c.previewUndo,
		);
		expect(dry.detail?.kind).toBe("account.undelete");
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(0);

		const undone = await expectBody<{
			result: { kind: string; result: { id: string } };
		}>(await send("POST", "/accounts/undo", { token: deleted.undo }), c.undo);
		expect(undone.result.kind).toBe("account.undelete");
		expect(undone.result.result.id).toBe(id);
		// Every column of every row, the balance the triggers moved included.
		expect(await state(id)).toEqual(before);
		expect(await state(other)).toEqual(otherBefore);
		expect(
			(await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })).balance,
		).toEqual(worth.balance);
		expect((await items()).find((a) => a.id === id)).toBeDefined();
	});

	it("keeps the token to the person who deleted, and spends it once", async () => {
		const id = await open("Private", "20");
		const deleted = await expectBody<Write>(
			await send("POST", `/accounts/${id}/delete`, { id }),
			c.delete,
		);
		await expectProblem(
			await send("POST", "/accounts/undo", { token: deleted.undo }, stranger),
			400,
			"bad_request",
		);
		await expectProblem(
			await send(
				"POST",
				"/accounts/undo/preview",
				{ token: deleted.undo },
				stranger,
			),
			400,
			"bad_request",
		);
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(0);

		await expectBody(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			c.undo,
		);
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(1);
		await expectProblem(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			409,
			"conflict",
		);
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(1);
	});

	it("refuses an undo whose stash is gone or whose moves are gone since", async () => {
		const { id, other } = await busyAccount();
		const deleted = await expectBody<Write>(
			await send("POST", `/accounts/${id}/delete`, { id }),
			c.delete,
		);
		// The move between the two is deleted from the other side meanwhile.
		const move = await adminDb.transfer.findFirstOrThrow({
			where: { OR: [{ fromAccountId: null }, { toAccountId: null }], userId },
			orderBy: { createdAt: "desc" },
		});
		await adminDb.transfer.delete({ where: { id: move.id } });
		await expectProblem(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			409,
			"conflict",
		);
		expect(await adminDb.assetAccount.count({ where: { id } })).toBe(0);
		// The refusal frees the stash and the token: nothing was taken.
		await adminDb.idempotencyKey.deleteMany({
			where: { userId, key: { startsWith: "undo-stash:" } },
		});
		await expectProblem(
			await send("POST", "/accounts/undo", { token: deleted.undo }),
			400,
			"bad_request",
		);
		expect(other).toBeDefined();
	});
});
