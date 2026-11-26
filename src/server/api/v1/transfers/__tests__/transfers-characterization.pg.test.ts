/**
 * M6 PR0: the v1 transfer writes as they behave today: the rows a create
 * leaves, the fee expense and its FEE leg, the preview that equals the
 * result, delete and undo both ways, and the refusals with their codes.
 * ARS home and ARS accounts only, so no rate decides a value (the rates the
 * accounts open at come from accounts/test-fixtures). Real clock.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { closeAccount } from "~/server/services/accounts/manage";
import {
	arsUser,
	balanceOf,
	isoDay,
	openAccount,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import {
	adminDb,
	asMobile,
	call,
	expectBody,
	expectProblem,
	fixtureDb,
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
		accounts: { name: string; before: Money; after: Money }[];
		budget: { effect: string; amount: Money | null; recorded: boolean };
		feeExpenseId: string | null;
	};
	undo: string;
};
type Preview = {
	changes: { id: string; delta: Money }[];
	unchanged: { id: string }[];
};

describe("/api/v1/transfers, as they behave today", () => {
	let userId: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;
	let savings: string;
	let wallet: string;
	let card: string;
	let otherSavings: string;

	beforeAll(async () => {
		await seedArsRates();
		userId = (await arsUser()).user.id;
		const otherId = (await arsUser()).user.id;
		as = { ...(await asMobile(userId)), "x-forwarded-for": "198.51.100.93" };
		asOther = {
			...(await asMobile(otherId)),
			"x-forwarded-for": "198.51.100.94",
		};
		savings = await openAccount(userId, "Savings", "CASH", "ARS", 5_000_000);
		wallet = await openAccount(userId, "Wallet", "CASH", "ARS", 1_000_000);
		card = await openAccount(
			userId,
			"Card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			842_600,
		);
		otherSavings = await openAccount(otherId, "Theirs", "CASH", "ARS", 100);
	});

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const create = async (body: unknown) =>
		expectBody<Write>(await post("/transfers", body), c.create, 201);

	it("a transfer with a fee leaves the transfer, two TRANSFER legs, a FEE leg and a Fee expense", async () => {
		const input = {
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
			note: "Rent share",
			date: isoDay(TODAY),
		};
		const dry = await expectBody<Preview>(
			await post("/transfers/preview", input),
			c.previewCreate,
		);
		const start = await balanceOf(savings);
		const moved = await create(input);

		expect(moved.transfer).toMatchObject({
			kind: "TRANSFER",
			from: { minor: 30_000_000, currency: "ARS" },
			to: { minor: 30_000_000, currency: "ARS" },
			budget: { effect: "none", amount: null, recorded: false },
		});
		const savingsRow = moved.transfer.accounts.find(
			(a) => a.name === "Savings",
		);
		expect(savingsRow).toMatchObject({
			before: { minor: Number(start) * 100, currency: "ARS" },
			after: { minor: (Number(start) - 301_500) * 100, currency: "ARS" },
		});
		// The preview named the same figures the write moved.
		expect(dry.changes.map((x) => x.id).sort()).toEqual(
			["accounts.balance", "netWorth", "spent"].sort(),
		);

		const id = moved.transfer.id;
		const transfer = await fixtureDb.transfer.findUniqueOrThrow({
			where: { id },
		});
		expect(transfer).toMatchObject({
			kind: "TRANSFER",
			note: "Rent share",
			feeExpenseId: moved.transfer.feeExpenseId,
			date: TODAY,
		});
		const legs = await adminDb.accountLeg.findMany({
			where: { transferId: id },
			orderBy: [{ source: "asc" }, { amount: "asc" }],
		});
		expect(
			legs.map((l) => [l.accountId, l.source, l.amount.toString()]),
		).toEqual([
			[savings, "TRANSFER", "-300000"],
			[wallet, "TRANSFER", "300000"],
			[savings, "FEE", "-1500"],
		]);
		expect(legs[2]?.expenseId).toBe(moved.transfer.feeExpenseId);
		const fee = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: moved.transfer.feeExpenseId ?? "" },
		});
		expect(fee).toMatchObject({
			title: "Fee",
			description: "Fee for a transfer",
			currency: "ARS",
		});
		expect(fee.amount.toString()).toBe("1500");
	});

	it("delete takes the move, its legs and the fee expense; its undo token makes the move again", async () => {
		const moved = await create({
			fromAccountId: savings,
			toAccountId: card,
			fromAmount: "1000",
			fee: { amount: "10" },
		});
		expect(moved.transfer.kind).toBe("CARD_PAYMENT");
		const id = moved.transfer.id;
		const feeId = moved.transfer.feeExpenseId ?? "";
		const afterMove = await balanceOf(savings);

		const deleted = await expectBody<{ id: string; undo: string }>(
			await call(`/transfers/${id}`, {
				method: "DELETE",
				headers: as,
				idempotent: true,
			}),
			c.delete,
		);
		expect(await fixtureDb.transfer.count({ where: { id } })).toBe(0);
		expect(await adminDb.accountLeg.count({ where: { transferId: id } })).toBe(
			0,
		);
		expect(await fixtureDb.expense.count({ where: { id: feeId } })).toBe(0);
		expect(Number(await balanceOf(savings))).toBe(Number(afterMove) + 1010);

		await expectBody(
			await post("/transfers/undo", { token: deleted.undo }),
			c.undo,
		);
		expect(await fixtureDb.transfer.count({ where: { id } })).toBe(1);
		expect(await balanceOf(savings)).toBe(afterMove);
		const again = await fixtureDb.transfer.findUniqueOrThrow({ where: { id } });
		// The fee is booked again as a new expense.
		expect(again.feeExpenseId).toEqual(expect.any(String));
		expect(again.feeExpenseId).not.toBe(feeId);
	});

	it("refuses a closed account, a future day and an exchange with no rate, all with 400, and writes nothing", async () => {
		const closed = await openAccount(userId, "Old", "CASH", "ARS", 10);
		await closeAccount(adminDb, userId, closed);
		const before = await adminDb.transfer.count({ where: { userId } });
		const bad = [
			{ fromAccountId: closed, toAccountId: wallet, fromAmount: "1" },
			{
				fromAccountId: savings,
				toAccountId: wallet,
				fromAmount: "1",
				date: "2999-01-01",
			},
			{
				fromAccountId: savings,
				toAccountId: null,
				toCurrency: "ZZZ",
				fromAmount: "1",
			},
		];
		for (const body of bad) {
			await expectProblem(await post("/transfers", body), 400, "bad_request");
		}
		expect(await adminDb.transfer.count({ where: { userId } })).toBe(before);
	});

	it("another person's account is 404 and the same client id twice is 409", async () => {
		await expectProblem(
			await post("/transfers", {
				fromAccountId: otherSavings,
				toAccountId: wallet,
				fromAmount: "1",
			}),
			404,
			"not_found",
		);
		expect(await balanceOf(otherSavings)).toBe("100");
		const id = randomUUID();
		const body = {
			id,
			fromAccountId: savings,
			toAccountId: wallet,
			fromAmount: "1",
		};
		await create(body);
		await expectProblem(await post("/transfers", body), 409, "id_taken");
		expect(await adminDb.transfer.count({ where: { id } })).toBe(1);
		await expectProblem(
			await post("/transfers", { ...body, id: randomUUID() }, asOther),
			404,
			"not_found",
		);
	});
});
