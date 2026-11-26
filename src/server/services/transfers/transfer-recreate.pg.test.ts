/**
 * Deleting a transfer that crossed the budget line, then undoing the delete,
 * puts its budget side back into the envelope it was in. ARS home, Blue 1 USD
 * = ARS 1,545. Wallet ARS 1,000,000 is in the budget; USD cash is outside it.
 *
 * By hand: Dining is assigned ARS 600,000. Buying USD 300 with ARS 463,500
 * (300 x 1,545) leaves the budget out of Dining: Dining left 600,000 - 463,500
 * = 136,500, To assign untouched. Selling USD 100 back (ARS 154,500) into
 * Dining enters it: left 136,500 + 154,500 = 291,000. The undo of a delete
 * brings each of these back exactly; before the fix it landed the money in
 * To assign and left Dining where the delete had put it.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { assignEnvelopes } from "~/server/services/envelope/movement.mutation";
import { getMonth } from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	openAccount,
	seedArsRates,
	TODAY,
	TODAY_ZONE,
} from "../accounts/test-fixtures";
import { createTransfer } from "./create.mutation";
import { deleteTransfer } from "./delete.mutation";

beforeAll(async () => {
	await seedArsRates();
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: TODAY, currency: "ARS", type: "blue" },
		},
		create: { date: TODAY, currency: "ARS", type: "blue", rate: "1545" },
		update: { rate: "1545" },
	});
});

async function world() {
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: { homeCurrency: "ARS", timeZone: TODAY_ZONE },
	});
	const wallet = await openAccount(
		s.user.id,
		"Digital wallet",
		"CASH",
		"ARS",
		1_000_000,
	);
	const usdCash = await openAccount(s.user.id, "USD cash", "CASH", "USD", 0, {
		exchangeRateType: "blue",
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		startingMoneyMinor: 100_000_000,
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (n: string) =>
		book.envelopes.find((e) => e.name === n)?.id as string;
	const month = (await getMonth(s.user.id))?.month.key as number;
	await forUser(s.user.id).apply(assignEnvelopes, {
		batchId: randomUUID(),
		month,
		mode: "add",
		items: [
			{ id: randomUUID(), envelopeId: id("Dining"), amountMinor: 60_000_000 },
		],
	});
	return { userId: s.user.id, wallet, usdCash, id };
}

type World = Awaited<ReturnType<typeof world>>;

/** Each envelope's Left, and To assign, in minor units. */
async function figures(w: World) {
	const m = await getMonth(w.userId);
	const left = Object.fromEntries(
		(m?.groups.flatMap((g) => g.envelopes) ?? []).map((e) => [
			e.name,
			e.left.minor,
		]),
	);
	return { left, toAssign: m?.toAssign.amount.minor };
}

const sideOf = async (transferId: string) => {
	const row = await adminDb.wealthTransfer.findFirst({ where: { transferId } });
	return row
		? {
				direction: row.direction,
				envelopeId: row.envelopeId,
				amount: row.amount.toString(),
			}
		: null;
};

describe("undoing the delete of a transfer that crossed the budget line", () => {
	it("a transfer out of an envelope comes back out of that envelope", async () => {
		const w = await world();
		const before = await figures(w);
		expect(before.left.Dining).toBe(60_000_000);

		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.wallet,
			toAccountId: w.usdCash,
			fromAmount: "463500",
			toAmount: "300",
			envelopeId: w.id("Dining"),
		});
		const id = made.value.transferId;
		const afterMove = await figures(w);
		expect(afterMove.left.Dining).toBe(13_650_000);
		expect(afterMove.toAssign).toBe(before.toAssign);
		const side = await sideOf(id);
		expect(side).toEqual({
			direction: "TO_WEALTH",
			envelopeId: w.id("Dining"),
			amount: "463500",
		});

		const deleted = await forUser(w.userId).apply(deleteTransfer, {
			transferId: id,
		});
		expect((await figures(w)).left.Dining).toBe(60_000_000);
		expect(await sideOf(id)).toBeNull();

		await forUser(w.userId).apply(createTransfer, deleted.value.recreate);
		expect(await sideOf(id)).toEqual(side);
		expect(await figures(w)).toEqual(afterMove);
	});

	it("a transfer into an envelope comes back into that envelope", async () => {
		const w = await world();
		await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.wallet,
			toAccountId: w.usdCash,
			fromAmount: "463500",
			toAmount: "300",
			envelopeId: w.id("Dining"),
		});
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.usdCash,
			toAccountId: w.wallet,
			fromAmount: "100",
			toAmount: "154500",
			putIn: w.id("Dining"),
		});
		const id = made.value.transferId;
		const afterMove = await figures(w);
		expect(afterMove.left.Dining).toBe(29_100_000);
		const side = await sideOf(id);
		expect(side).toEqual({
			direction: "FROM_WEALTH",
			envelopeId: w.id("Dining"),
			amount: "154500",
		});

		const deleted = await forUser(w.userId).apply(deleteTransfer, {
			transferId: id,
		});
		expect((await figures(w)).left.Dining).toBe(13_650_000);

		await forUser(w.userId).apply(createTransfer, deleted.value.recreate);
		expect(await sideOf(id)).toEqual(side);
		expect(await figures(w)).toEqual(afterMove);
	});

	it("a transfer that went to To assign comes back to To assign", async () => {
		const w = await world();
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.wallet,
			toAccountId: w.usdCash,
			fromAmount: "463500",
			toAmount: "300",
		});
		const id = made.value.transferId;
		const afterMove = await figures(w);
		const side = await sideOf(id);
		expect(side?.envelopeId).toBeNull();
		const deleted = await forUser(w.userId).apply(deleteTransfer, {
			transferId: id,
		});
		await forUser(w.userId).apply(createTransfer, deleted.value.recreate);
		expect(await sideOf(id)).toEqual(side);
		expect(await figures(w)).toEqual(afterMove);
	});

	it("the delete's preview and its undo agree on what changes", async () => {
		const w = await world();
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.wallet,
			toAccountId: w.usdCash,
			fromAmount: "463500",
			toAmount: "300",
			envelopeId: w.id("Dining"),
		});
		const deleted = await forUser(w.userId).apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		const preview = await forUser(w.userId).preview(
			createTransfer,
			deleted.value.recreate,
		);
		const applied = await forUser(w.userId).apply(
			createTransfer,
			deleted.value.recreate,
		);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.value.budget).toEqual(preview.value.budget);
	});
});
