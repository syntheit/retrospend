/**
 * /api/v1/transfers on Postgres: transfer with a fee, exchange, card
 * payment and withdrawal through the real mutation, previews equal results,
 * undo and redo, idempotent replay, cross-user 404. ARS home; rates ARS
 * 1,468 Blue and 1,412 Official per USD (accounts/test-fixtures).
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.transfers;
type Money = { minor: number; currency: string };
type Write = {
	transfer: {
		id: string;
		kind: string;
		from: Money;
		to: Money;
		rate: { unit: Money; value: Money } | null;
		vsReference: Money | null;
		accounts: { name: string; before: Money; after: Money }[];
		budget: { effect: string; amount: Money | null };
		feeExpenseId: string | null;
	};
	undo: string;
};
type Preview = { changes: { id: string; delta: Money }[] };

describe("/api/v1/transfers", () => {
	useApiV1();
	let userId: string;
	let otherId: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;
	let savings: string;
	let wallet: string;
	let card: string;
	let usdCash: string;

	beforeAll(async () => {
		await seedArsRates();
		userId = (await arsUser()).user.id;
		otherId = (await arsUser()).user.id;
		as = await asMobile(userId);
		asOther = await asMobile(otherId);
		savings = await openAccount(userId, "Savings", "CASH", "ARS", 5_000_000);
		wallet = await openAccount(userId, "Wallet", "CASH", "ARS", 1_000_000);
		card = await openAccount(
			userId,
			"Credit card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			842_600,
		);
		usdCash = await openAccount(userId, "USD cash", "CASH", "USD", 0, {
			exchangeRateType: "blue",
		});
	});

	const post = (path: string, body: unknown, headers = as, key?: string) =>
		call(path, { method: "POST", headers, body, idempotent: key ?? true });
	const transfer = async (body: unknown, headers = as) =>
		expectBody<Write>(await post("/transfers", body, headers), c.create, 201);

	it("moves money between accounts with a fee, and says what changed", async () => {
		const moved = await transfer({
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
		});
		expect(moved.transfer).toMatchObject({
			kind: "TRANSFER",
			from: { minor: 30_000_000, currency: "ARS" },
			to: { minor: 30_000_000, currency: "ARS" },
			budget: { effect: "none", amount: null },
		});
		expect(moved.transfer.feeExpenseId).toBeTruthy();
		expect(moved.transfer.accounts.map((a) => a.name).sort()).toEqual([
			"Savings",
			"Wallet",
		]);
		// 5,000,000 - 300,000 - 1,500.
		expect(await balanceOf(savings)).toBe("4698500");
		expect(await balanceOf(wallet)).toBe("1300000");
	});

	it("exchanges at the typed amounts and shows the cost against the reference rate", async () => {
		const moved = await transfer({
			fromAccountId: wallet,
			toAccountId: usdCash,
			fromAmount: "442500",
			toAmount: "300",
		});
		expect(moved.transfer).toMatchObject({
			kind: "EXCHANGE",
			from: { minor: 44_250_000, currency: "ARS" },
			to: { minor: 30_000, currency: "USD" },
			rate: {
				unit: { minor: 100, currency: "USD" },
				value: { minor: 147_500, currency: "ARS" },
			},
			// ARS 442,500 against 300 x 1,468 = 440,400 at Blue.
			vsReference: { minor: -210_000, currency: "ARS" },
			budget: {
				effect: "leaves",
				amount: { minor: 44_250_000, currency: "ARS" },
			},
		});
	});

	it("pays the card without moving net worth, and withdraws cash", async () => {
		const pay = await transfer({
			fromAccountId: savings,
			toAccountId: card,
			fromAmount: "842600",
		});
		expect(pay.transfer.kind).toBe("CARD_PAYMENT");
		const out = await transfer({
			fromAccountId: wallet,
			toAccountId: null,
			toCurrency: "ARS",
			fromAmount: "1000",
			kind: "WITHDRAWAL",
		});
		expect(out.transfer.kind).toBe("WITHDRAWAL");
	});

	it("previews a transfer and leaves balances alone", async () => {
		const before = await balanceOf(savings);
		const preview = await expectBody<Preview>(
			await post("/transfers/preview", {
				fromAccountId: savings,
				toAccountId: wallet,
				fromAmount: "1000",
				fee: { amount: "50" },
			}),
			c.previewCreate,
		);
		expect(await balanceOf(savings)).toBe(before);
		expect(preview.changes.find((x) => x.id === "netWorth")?.delta).toEqual({
			minor: -5000,
			currency: "ARS",
		});
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: 5000,
			currency: "ARS",
		});
	});

	it("replays a create with the same key and moves money once", async () => {
		const key = randomUUID();
		const data = {
			fromAccountId: wallet,
			toAccountId: savings,
			fromAmount: "10",
		};
		const start = Number(await balanceOf(wallet));
		const first = await post("/transfers", data, as, key);
		const second = await post("/transfers", data, as, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		expect(Number(await balanceOf(wallet))).toBe(start - 10);
	});

	it("undoes a transfer and redoes it", async () => {
		const moved = await transfer({
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "2000",
		});
		const savingsAfter = await balanceOf(savings);
		const walletAfter = await balanceOf(wallet);

		const undone = await expectBody<{ id: string; redo: string }>(
			await post("/transfers/undo", { token: moved.undo }),
			c.undo,
		);
		expect(undone.id).toBe(moved.transfer.id);
		expect(Number(await balanceOf(savings))).toBe(Number(savingsAfter) + 2000);
		expect(Number(await balanceOf(wallet))).toBe(Number(walletAfter) - 2000);

		await expectBody(
			await post("/transfers/undo", { token: undone.redo }),
			c.undo,
		);
		expect(await balanceOf(savings)).toBe(savingsAfter);
		expect(await balanceOf(wallet)).toBe(walletAfter);
	});

	it("deletes a transfer with a preview, and its undo recreates it", async () => {
		const moved = await transfer({
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "3000",
		});
		const id = moved.transfer.id;
		const preview = await expectBody<Preview & { unchanged: { id: string }[] }>(
			await post(`/transfers/${id}/preview`, {}),
			c.previewDelete,
		);
		// Between two of your own accounts, net worth stays put.
		expect(preview.changes.find((x) => x.id === "netWorth")).toBeUndefined();
		expect(preview.unchanged.map((x) => x.id)).toContain("netWorth");
		await expect(adminDb.transfer.count({ where: { id } })).resolves.toBe(1);

		const deleted = await expectBody<{ id: string; undo: string }>(
			await call(`/transfers/${id}`, {
				method: "DELETE",
				headers: as,
				idempotent: true,
			}),
			c.delete,
		);
		await expect(adminDb.transfer.count({ where: { id } })).resolves.toBe(0);
		await expectBody(
			await post("/transfers/undo", { token: deleted.undo }),
			c.undo,
		);
		await expect(adminDb.transfer.count({ where: { id } })).resolves.toBe(1);
	});

	it("keeps accounts and transfers to their owner", async () => {
		const moved = await transfer({
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "5",
		});
		await expectProblem(
			await post(
				"/transfers",
				{ fromAccountId: savings, toAccountId: wallet, fromAmount: "5" },
				asOther,
			),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/transfers/${moved.transfer.id}`, {
				method: "DELETE",
				headers: asOther,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		await expectProblem(
			await post(`/transfers/${moved.transfer.id}/preview`, {}, asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await post("/transfers/undo", { token: moved.undo }, asOther),
			400,
			"bad_request",
		);
	});

	it("refuses bad money and a token without write:money", async () => {
		await expectProblem(
			await post("/transfers", {
				fromAccountId: savings,
				toAccountId: wallet,
				fromAmount: 100,
			}),
			400,
			"validation_failed",
		);
		const expensesOnly = await asKey(userId, ["write:expenses"]);
		await expectProblem(
			await post(
				"/transfers",
				{ fromAccountId: savings, toAccountId: wallet, fromAmount: "1" },
				expensesOnly,
			),
			403,
			"missing_scope",
		);
	});
});
