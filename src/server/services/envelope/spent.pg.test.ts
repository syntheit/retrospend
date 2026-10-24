/**
 * What an envelope spent this month on Postgres (the Budget row's bar and
 * `envelope.spent`). USD book, cents. Expected values by hand:
 *
 *   Dining: expenses 150.00 and 12.50, a refund of 5.00 in its category.
 *   Spent = 15,000 + 1,250 - 500 = 15,750. Its Activity is -15,750 (the
 *   Flex setup assigns nothing to it), so Spent is Activity's sign flipped.
 *   Rent: nothing spent, spent 0.
 *   The figure `envelope.spent` narrowed by Dining's id reads 15,750 USD;
 *   narrowed by Rent's id, 0; without a narrowing it is unavailable.
 *   Its bar: with nothing assigned it holds nothing, so it reads full
 *   (10000). After 300.00 is assigned it holds 30,000 and spent 15,750 of
 *   it: 15,750 * 10,000 / 30,000 = 5,250 (52.5%), rounded down. Rent, which
 *   spent nothing, reads 0.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import { budgetMonthOf, isoDateIn } from "./months";
import { assignEnvelopes } from "./movement.mutation";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });

describe("envelope spent this month", () => {
	let s: Awaited<ReturnType<typeof seedUser>>;
	let ids: Record<string, string>;

	beforeAll(async () => {
		s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
			include: { envelopes: true },
		});
		ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
		await addRow(s.user.id, { amount: 150, categoryId: s.dining });
		await addRow(s.user.id, { amount: 12.5, categoryId: s.dining });
		await addRow(s.user.id, {
			amount: 5,
			categoryId: s.dining,
			direction: "IN",
			inType: "REFUND",
		});
	});

	it("is spending minus refunds, positive, beside the negative Activity", async () => {
		const m = await getMonth(s.user.id);
		const dining = m?.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === ids.Dining);
		expect(dining?.spent).toEqual(usd(15_750));
		expect(dining?.activity).toEqual(usd(-15_750));
		const rent = m?.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === ids.Rent);
		expect(rent?.spent).toEqual(usd(0));
	});

	it("reads as a figure narrowed to one envelope", async () => {
		const dining = await readFigures(s.user.id, ["envelope.spent"], {
			envelopeId: ids.Dining,
		});
		expect(dining.get("envelope.spent")).toEqual([usd(15_750)]);
		const rent = await readFigures(s.user.id, ["envelope.spent"], {
			envelopeId: ids.Rent,
		});
		expect(rent.get("envelope.spent")).toEqual([usd(0)]);
		const none = await readFigures(s.user.id, ["envelope.spent"]);
		expect(none.get("envelope.spent")).toBeNull();
	});

	it("gives the row's bar as a whole share of what it holds", async () => {
		const bar = async (name: string) =>
			(await getMonth(s.user.id))?.groups
				.flatMap((g) => g.envelopes)
				.find((e) => e.id === ids[name])?.spentBasis;
		expect(await bar("Dining")).toBe(10_000);
		const month = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
			{ fromMonth: 0, startDay: 1 },
		]);
		await forUser(s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month,
			mode: "add",
			items: [
				{
					id: randomUUID(),
					envelopeId: ids.Dining as string,
					amountMinor: 30_000,
				},
			],
		});
		expect(await bar("Dining")).toBe(5_250);
		expect(await bar("Rent")).toBe(0);
	});
});
