/**
 * Deleting a transfer over /api/v1/transfers and undoing the delete puts back
 * the rows that were there, as stored (transfers/stash.ts): a debt payment's
 * budget side for the principal, its interest as Fees spending in its
 * envelope, the NOT_SPENDING mark from outside the budget; a plain transfer's
 * fee as the user left it. Nothing is inferred from today's budget flags. ARS book (blue 1 USD = 1,545 ARS, unused: every leg is ARS).
 *
 * Seed (ARS): starting money 200,000; envelope E "Card payoff" assigned
 * 150,000, so To assign is 50,000. Wallet 400,000 (in the budget), Card
 * owing 300,000 (in the budget, so a payment from the wallet crosses
 * nothing and the principal's TO_WEALTH is written by the debt path),
 * Brokerage 400,000 (outside the budget), Loan owing 300,000 (outside).
 * Pay 100,000 principal + 5,000 interest from the Wallet, envelope E:
 *   Card 200,000; Wallet 400,000 - 105,000 = 295,000.
 *   E: assigned 150,000, activity -105,000, left 45,000; To assign 50,000.
 *   One TO_WEALTH of 100,000 out of E; interest 5,000 in Fees, in E.
 * After the delete: Card 300,000, Wallet 400,000, E left 150,000.
 * After the undo: every figure above again. Before the fix the undo was a
 * plain transfer: no budget side (E's Left stayed 100,000 too high) and the
 * interest an uncategorized "Fee" in no envelope.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { describe, expect, it, vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import {
	openAccount,
	seedArsRates,
	TODAY,
	TODAY_ZONE,
} from "~/server/services/accounts/test-fixtures";
import { mintUndo, readUndo } from "~/server/services/api-v1/undo";
import { assignEnvelopes } from "~/server/services/envelope/movement.mutation";
import { getMonth } from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import type { TransferStash } from "~/server/services/transfers/stash";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.transfers;
const b = contract.budget;
type Money = { minor: number; currency: string };
type Preview = { changes: { id: string; delta: Money }[] };

const setup = (dining: string): SetupInput => ({
	style: "FLEX",
	startingMoneyMinor: 20_000_000,
	groups: [
		{ key: "bills", name: "Bills", role: "BILLS" },
		{ key: "spending", name: "Spending", role: "SPENDING" },
	],
	envelopes: [
		{
			key: "dining",
			name: "Dining",
			groupKey: "spending",
			kind: "MONTHLY",
			isDefault: false,
			categoryIds: [dining],
		},
		{
			key: "spending",
			name: "Spending",
			groupKey: "spending",
			kind: "MONTHLY",
			isDefault: true,
			categoryIds: [],
		},
		{
			key: "payoff",
			name: "Card payoff",
			groupKey: "bills",
			kind: "MONTHLY",
			isDefault: false,
			categoryIds: [],
		},
	],
});

async function world() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", timeZone: TODAY_ZONE },
	});
	await seedArsRates();
	await adminDb.exchangeRate.update({
		where: {
			date_currency_type: { date: TODAY, currency: "ARS", type: "blue" },
		},
		data: { rate: "1545" },
	});
	const cat = (name: string) =>
		fixtureDb.category
			.create({ data: { name, color: "red", userId: user.id } })
			.then((x) => x.id);
	const fees = await cat("Fees");
	const dining = await cat("Dining");
	const wallet = await openAccount(user.id, "Wallet", "CASH", "ARS", 400_000);
	const card = await openAccount(
		user.id,
		"Card",
		"LIABILITY_CREDIT_CARD",
		"ARS",
		300_000,
	);
	const brokerage = await openAccount(
		user.id,
		"Brokerage",
		"INVESTMENT",
		"ARS",
		400_000,
	);
	const loan = await openAccount(
		user.id,
		"Loan",
		"LIABILITY_LOAN",
		"ARS",
		300_000,
	);
	await forUser(user.id).apply(setupEnvelopeBook, {
		...setup(dining),
		timeZone: TODAY_ZONE,
	});
	const envelopes = await adminDb.envelope.findMany({
		where: { book: { createdById: user.id } },
	});
	const E = envelopes.find((e) => e.name === "Card payoff")?.id as string;
	const as = await asMobile(user.id);
	const month = (await getMonth(user.id))?.month.key as number;
	// 150,000 into E: the envelope Left the payments are measured against.
	await forUser(user.id).apply(assignEnvelopes, {
		batchId: randomUUID(),
		month,
		mode: "add",
		items: [{ id: randomUUID(), envelopeId: E, amountMinor: 15_000_000 }],
	});
	return { user, as, E, fees, dining, wallet, card, brokerage, loan };
}

type World = Awaited<ReturnType<typeof world>>;

const send = (w: World, method: string, path: string, body?: unknown) =>
	call(path, { method, headers: w.as, body, idempotent: method !== "GET" });

/** Everything a payment writes, read by id (never by a sealed name), minus the ids a replay makes. */
async function snapshot(w: World, transferId: string, accounts: string[]) {
	const month = await getMonth(w.user.id);
	const row = month?.groups
		.flatMap((g) => g.envelopes)
		.find((e) => e.id === w.E);
	const transfer = await adminDb.transfer.findUnique({
		where: { id: transferId },
	});
	const fee = transfer?.feeExpenseId
		? await adminDb.expense.findUnique({ where: { id: transfer.feeExpenseId } })
		: null;
	const sides = await adminDb.wealthTransfer.findMany({
		where: { transferId },
	});
	const legs = (await adminDb.accountLeg.findMany({ where: { transferId } }))
		.map((l) => [l.accountId, l.source, l.amount.toString()].join(":"))
		.sort();
	const balances: Record<string, string> = {};
	for (const id of accounts) {
		const a = await adminDb.assetAccount.findUniqueOrThrow({ where: { id } });
		balances[id] = a.balance.toString();
	}
	return {
		envelope: [row?.assigned.minor, row?.activity.minor, row?.left.minor],
		toAssign: month?.toAssign.amount.minor,
		balances,
		legs,
		transfer: transfer && {
			kind: transfer.kind,
			from: transfer.fromAccountId,
			to: transfer.toAccountId,
			fromAmount: transfer.fromAmount.toString(),
			toAmount: transfer.toAmount.toString(),
			date: transfer.date.toISOString(),
			hasFee: transfer.feeExpenseId !== null,
		},
		fee: fee && {
			amount: fee.amount.toString(),
			categoryId: fee.categoryId,
			budgetEnvelopeId: fee.budgetEnvelopeId,
			entryKind: fee.entryKind,
			excludeFromAnalytics: fee.excludeFromAnalytics,
			date: fee.date.toISOString(),
		},
		sides: sides.map((s) => ({
			direction: s.direction,
			amount: s.amount.toString(),
			envelopeId: s.envelopeId,
			assetAccountId: s.assetAccountId,
		})),
	};
}

async function pay(
	w: World,
	o: { liabilityId: string; fromAccountId: string | null; interest: string },
) {
	const id = randomUUID();
	const written = await expectBody<{ result: unknown; undo: string }>(
		await send(w, "POST", "/budget/debt-payments", {
			id,
			liabilityId: o.liabilityId,
			fromAccountId: o.fromAccountId,
			envelopeId: w.E,
			principal: "100000",
			interest: o.interest,
		}),
		b.recordDebtPayment,
		201,
	);
	return { id, written };
}

/** Delete over v1, then undo with the token it gave. */
async function deleteAndUndo(w: World, id: string) {
	const deleted = await expectBody<{ undo: string }>(
		await send(w, "DELETE", `/transfers/${id}`),
		c.delete,
	);
	const preview = await expectBody<Preview>(
		await send(w, "POST", "/transfers/undo/preview", { token: deleted.undo }),
		c.previewUndo,
	);
	const undone = await expectBody<{ redo: string }>(
		await send(w, "POST", "/transfers/undo", { token: deleted.undo }),
		c.undo,
	);
	return { deleted, preview, undone };
}

describe("undoing the delete of a transfer over /api/v1/transfers restores the rows that were there", () => {
	it("a card paid from the wallet: envelope Left, To assign, budget side and interest come back", async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.card,
			fromAccountId: w.wallet,
			interest: "5000",
		});
		const accounts = [w.wallet, w.card];
		const paid = await snapshot(w, id, accounts);
		expect(paid.envelope).toEqual([15_000_000, -10_500_000, 4_500_000]);
		expect(paid.toAssign).toBe(5_000_000);
		expect(paid.balances).toEqual({
			[w.wallet]: "295000",
			[w.card]: "200000",
		});
		expect(paid.sides).toEqual([
			{
				direction: "TO_WEALTH",
				amount: "100000",
				envelopeId: w.E,
				assetAccountId: w.card,
			},
		]);
		expect(paid.fee).toMatchObject({
			amount: "5000",
			categoryId: w.fees,
			budgetEnvelopeId: w.E,
			entryKind: "STANDARD",
		});

		const deleted = await expectBody<{ undo: string }>(
			await send(w, "DELETE", `/transfers/${id}`),
			c.delete,
		);
		const afterDelete = await snapshot(w, id, accounts);
		expect(afterDelete.envelope).toEqual([15_000_000, 0, 15_000_000]);
		expect(afterDelete.balances).toEqual({
			[w.wallet]: "400000",
			[w.card]: "300000",
		});
		const preview = await expectBody<Preview>(
			await send(w, "POST", "/transfers/undo/preview", { token: deleted.undo }),
			c.previewUndo,
		);
		// The preview is a dry run of the real write: E's Left falls by 105,000.
		expect(
			preview.changes.find((x) => x.id === "envelope.left")?.delta,
		).toEqual({ minor: -10_500_000, currency: "ARS" });
		const undone = await expectBody<{ redo: string }>(
			await send(w, "POST", "/transfers/undo", { token: deleted.undo }),
			c.undo,
		);
		expect(await snapshot(w, id, accounts)).toEqual(paid);

		// The redo deletes it again, and that delete can be undone too.
		await expectBody(
			await send(w, "POST", "/transfers/undo", { token: undone.redo }),
			c.undo,
		);
		expect((await snapshot(w, id, accounts)).envelope).toEqual([
			15_000_000, 0, 15_000_000,
		]);
	});

	it("a loan outside the budget paid from the wallet keeps its interest in E", async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.loan,
			fromAccountId: w.wallet,
			interest: "5000",
		});
		const accounts = [w.wallet, w.loan];
		const paid = await snapshot(w, id, accounts);
		expect(paid.envelope).toEqual([15_000_000, -10_500_000, 4_500_000]);
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("from outside the budget: no envelope moves and the interest stays NOT_SPENDING", async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.card,
			fromAccountId: w.brokerage,
			interest: "5000",
		});
		const accounts = [w.brokerage, w.card];
		const paid = await snapshot(w, id, accounts);
		expect(paid.envelope).toEqual([15_000_000, 0, 15_000_000]);
		expect(paid.toAssign).toBe(5_000_000);
		expect(paid.sides).toEqual([]);
		expect(paid.fee).toMatchObject({
			categoryId: w.fees,
			entryKind: "NOT_SPENDING",
		});
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("with no interest, paid from the pool or an envelope, the principal side is restored", async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.card,
			fromAccountId: w.wallet,
			interest: "0",
		});
		const accounts = [w.wallet, w.card];
		const paid = await snapshot(w, id, accounts);
		expect(paid.envelope).toEqual([15_000_000, -10_000_000, 5_000_000]);
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("a plain card payment made with POST /transfers stays a plain transfer", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string }; undo: string }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "100000",
				fee: { amount: "5000" },
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		const accounts = [w.wallet, w.card];
		const plain = await snapshot(w, id, accounts);
		// Both in the budget: no budget side, and the fee is an uncategorized Fee.
		expect(plain.sides).toEqual([]);
		expect(plain.fee).toMatchObject({
			categoryId: null,
			budgetEnvelopeId: null,
			entryKind: "STANDARD",
		});
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(plain);
	});

	it("a plain card payment whose fee the user categorized: the fee keeps Dining and no side appears", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string } }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "100000",
				fee: { amount: "5000" },
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		const fee = await adminDb.transfer.findUniqueOrThrow({ where: { id } });
		await adminDb.expense.update({
			where: { id: fee.feeExpenseId as string },
			data: { categoryId: w.dining },
		});
		const accounts = [w.wallet, w.card];
		const edited = await snapshot(w, id, accounts);
		expect(edited.fee).toMatchObject({ categoryId: w.dining });
		expect(edited.sides).toEqual([]);
		// Wallet 400,000 - 105,000; the card owes 200,000; To assign stays 50,000.
		expect(edited.balances).toEqual({
			[w.wallet]: "295000",
			[w.card]: "200000",
		});
		await deleteAndUndo(w, id);
		const back = await snapshot(w, id, accounts);
		expect(back).toEqual(edited);
		expect(back.toAssign).toBe(5_000_000);
	});

	it("a fee taken from another account comes back on that account", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string } }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "100000",
				fee: { amount: "5000", accountId: w.brokerage },
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		const accounts = [w.wallet, w.card, w.brokerage];
		const paid = await snapshot(w, id, accounts);
		// The fee left the Brokerage (400,000 to 395,000); the Wallet only paid the principal.
		expect(paid.balances).toEqual({
			[w.wallet]: "300000",
			[w.card]: "200000",
			[w.brokerage]: "395000",
		});
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("a card paid past what it owes can be restored", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string } }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "350000",
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		const accounts = [w.wallet, w.card];
		const paid = await snapshot(w, id, accounts);
		// 350,000 into a card that owed 300,000: it now holds 50,000 of yours.
		expect(paid.balances).toEqual({ [w.wallet]: "50000", [w.card]: "-50000" });
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("a card moved out of the budget after the payment: the stored side still comes back", async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.card,
			fromAccountId: w.wallet,
			interest: "5000",
		});
		await adminDb.assetAccount.update({
			where: { id: w.card },
			data: { inBudget: false },
		});
		const accounts = [w.wallet, w.card];
		const paid = await snapshot(w, id, accounts);
		expect(paid.sides).toHaveLength(1);
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});

	it("a wallet moved out of the budget after a plain payment: no side is invented", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string } }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "100000",
				fee: { amount: "5000" },
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		await adminDb.assetAccount.update({
			where: { id: w.wallet },
			data: { inBudget: false },
		});
		const accounts = [w.wallet, w.card];
		const paid = await snapshot(w, id, accounts);
		expect(paid.sides).toEqual([]);
		await deleteAndUndo(w, id);
		expect(await snapshot(w, id, accounts)).toEqual(paid);
	});
});

/**
 * The stash guards (transfers/stash.ts). Each test deletes a debt payment,
 * edits the stash inside its signed token and mints it again, so it trips one
 * guard only and nothing is written when the undo is refused.
 */
describe("a stash the undo refuses or repairs", () => {
	type Edit = (restore: TransferStash) => void;

	async function undoWith(w: World, id: string, edit: Edit) {
		const deleted = await expectBody<{ undo: string }>(
			await send(w, "DELETE", `/transfers/${id}`),
			c.delete,
		);
		const { op, input } = readUndo(w.user.id, "transfer", deleted.undo);
		const next = structuredClone(input) as { restore: TransferStash };
		edit(next.restore);
		const token = mintUndo(w.user.id, "transfer", op, next);
		return send(w, "POST", "/transfers/undo", { token });
	}

	const paid = async () => {
		const w = await world();
		const { id } = await pay(w, {
			liabilityId: w.card,
			fromAccountId: w.wallet,
			interest: "5000",
		});
		return { w, id };
	};
	const gone = (id: string) => adminDb.transfer.count({ where: { id } });

	it("refuses a stash of an unknown shape (400) and writes nothing", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				(r as unknown as Record<string, unknown>).extra = true;
			}),
			400,
			"bad_request",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("refuses a side that belongs to another transfer (400)", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				r.sides[0].transferId = randomUUID();
			}),
			400,
			"bad_request",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("refuses a side written by someone else (400)", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				r.sides[0].actorUserId = randomUUID();
			}),
			400,
			"bad_request",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("conflicts when the side's envelope is gone (409)", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				r.sides[0].envelopeId = randomUUID();
			}),
			409,
			"conflict",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("conflicts when the side's book is gone (409)", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				r.sides[0].bookId = randomUUID();
				r.sides[0].envelopeId = null;
			}),
			409,
			"conflict",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("conflicts when the side's account is gone (409)", async () => {
		const { w, id } = await paid();
		await expectProblem(
			await undoWith(w, id, (r) => {
				r.sides[0].assetAccountId = randomUUID();
			}),
			409,
			"conflict",
		);
		await expect(gone(id)).resolves.toBe(0);
	});

	it("leaves the fee uncategorized when its category was deleted since", async () => {
		const w = await world();
		const made = await expectBody<{ transfer: { id: string } }>(
			await send(w, "POST", "/transfers", {
				fromAccountId: w.wallet,
				toAccountId: w.card,
				fromAmount: "100000",
				fee: { amount: "5000" },
			}),
			c.create,
			201,
		);
		const id = made.transfer.id;
		const temp = await fixtureDb.category.create({
			data: { name: "Temp", color: "red", userId: w.user.id },
		});
		const row = await adminDb.transfer.findUniqueOrThrow({ where: { id } });
		await adminDb.expense.update({
			where: { id: row.feeExpenseId as string },
			data: { categoryId: temp.id },
		});
		const deleted = await expectBody<{ undo: string }>(
			await send(w, "DELETE", `/transfers/${id}`),
			c.delete,
		);
		await adminDb.category.delete({ where: { id: temp.id } });
		await expectBody(
			await send(w, "POST", "/transfers/undo", { token: deleted.undo }),
			c.undo,
		);
		const back = await adminDb.transfer.findUniqueOrThrow({ where: { id } });
		const fee = await adminDb.expense.findUniqueOrThrow({
			where: { id: back.feeExpenseId as string },
		});
		expect(fee.categoryId).toBeNull();
		expect(fee.amount.toString()).toBe("5000");
	});
});
