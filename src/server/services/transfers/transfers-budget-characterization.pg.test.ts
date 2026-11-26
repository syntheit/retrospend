/**
 * M6 PR0: a transfer that crosses the budget line, with and without an
 * envelope book, and what its delete does to the budget's side of it. These
 * stay online in M6, so the tests pin today's answers for the engine's
 * "unknown means online" gate. ARS home, rates ARS 1,468 Blue and 1,412
 * Official (accounts/test-fixtures), the real clock.
 *
 * Hand-derived: ARS 442,500.00 into USD 300.00 leaves the budget by the
 * in-budget leg as typed, 442,500.00 (minor 44,250,000). The USD leg is
 * booked at Blue: 300 x 1,468 = ARS 440,400.00, so net worth moves by
 * -2,100.00 (the cost of the exchange against the reference).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { setupInput } from "~/server/services/envelope/__tests__/pg-fixture";
import { findPersonalBook } from "~/server/services/envelope/inputs";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
	TODAY_ZONE,
} from "../accounts/test-fixtures";
import { type CreateTransferInput, createTransfer } from "./create.mutation";
import { deleteTransfer } from "./delete.mutation";

beforeAll(seedArsRates);

async function world(withBook: boolean) {
	const { user } = await arsUser();
	const id = user.id;
	const wallet = await openAccount(id, "Wallet", "CASH", "ARS", 1_000_000);
	const usdCash = await openAccount(id, "USD cash", "CASH", "USD", 0, {
		exchangeRateType: "blue",
	});
	let envelopeId: string | null = null;
	if (withBook) {
		const cat = (name: string) =>
			fixtureDb.category
				.create({ data: { name, color: "blue", userId: id } })
				.then((c) => c.id);
		await forUser(id).apply(setupEnvelopeBook, {
			...setupInput({ rent: await cat("Rent"), dining: await cat("Dining") }),
			timeZone: TODAY_ZONE,
		});
		const book = await userTransaction(adminDb, id, (tx) =>
			findPersonalBook(tx, id),
		);
		envelopeId =
			book?.envelopes.find((e) => e.id !== book.defaultEnvelopeId)?.id ?? null;
	}
	return { userId: id, wallet, usdCash, envelopeId };
}

const sides = (transferId: string) =>
	adminDb.wealthTransfer.findMany({ where: { transferId } });
const out = (w: Awaited<ReturnType<typeof world>>): CreateTransferInput => ({
	fromAccountId: w.wallet,
	toAccountId: w.usdCash,
	fromAmount: "442500",
	toAmount: "300",
});

describe("a crossing transfer", () => {
	it("without an envelope book writes no budget side and says why", async () => {
		const w = await world(false);
		const r = await forUser(w.userId).apply(createTransfer, out(w));
		expect(r.value.budget).toMatchObject({
			effect: "leaves",
			minor: 44_250_000,
			side: { recorded: false, reason: "no_envelope_budget" },
		});
		expect(await sides(r.value.transferId)).toEqual([]);
		expect(r.value.netWorthEffect).toEqual({
			minor: -210_000,
			currency: "ARS",
		});
	});

	it("with a book writes a WealthTransfer from To assign, and the delete's cascade removes it", async () => {
		const w = await world(true);
		const run = forUser(w.userId);
		const made = await run.apply(createTransfer, out(w));
		expect(made.value.budget.side).toEqual({ recorded: true, reason: null });
		const [side] = await sides(made.value.transferId);
		expect(side).toMatchObject({
			direction: "TO_WEALTH",
			envelopeId: null,
			assetAccountId: w.usdCash,
			countOnly: false,
			sourceExpenseId: null,
			actorUserId: w.userId,
		});
		expect(side?.amount.toString()).toBe("442500");

		const removed = await run.apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		expect(await sides(made.value.transferId)).toEqual([]);
		expect(await balanceOf(w.wallet)).toBe("1000000");

		const back = await run.apply(createTransfer, removed.value.recreate);
		const [again] = await sides(back.value.transferId);
		expect(again?.direction).toBe("TO_WEALTH");
		// A new budget row: the old one went with its transfer.
		expect(again?.id).not.toBe(side?.id);
	});

	it("takes the envelope it comes from, but the undo of its delete forgets it and lands in To assign", async () => {
		const w = await world(true);
		expect(w.envelopeId).not.toBeNull();
		const run = forUser(w.userId);
		const made = await run.apply(createTransfer, {
			...out(w),
			envelopeId: w.envelopeId,
		});
		expect((await sides(made.value.transferId))[0]?.envelopeId).toBe(
			w.envelopeId,
		);

		const removed = await run.apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		// The recreate input carries no envelope (found, pinned as it is).
		expect(removed.value.recreate).not.toHaveProperty("envelopeId");
		expect(removed.value.recreate).not.toHaveProperty("putIn");
		const back = await run.apply(createTransfer, removed.value.recreate);
		expect((await sides(back.value.transferId))[0]?.envelopeId).toBeNull();
	});
});
