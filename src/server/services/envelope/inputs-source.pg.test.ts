/**
 * Conformance of the Postgres budget inputs port with its pure twins in
 * @retrospend/domain/envelope: the grouped SUM over numeric equals
 * groupMovements to the last digit, and the rate SQL returns the rows
 * selectRateRows picks. A device loader uses the twins, so these two tests are
 * what make the server and the device read the same inputs.
 *
 * Expected values by hand, ARS-like amounts (2 decimals, large):
 *   202610 pool -> Food: 1,850,000.50 + 99.25 + 0.25 = 1,850,100.00
 *   202610 Food -> Fun:  0.00000001 x 3                = 0.00000003
 *   202611 pool -> Food: 11 x 99,999,999,999.99999999
 *                        = 11 x 10^11 - 11 x 10^-8 = 1,099,999,999,999.99999989
 *   202609 pool -> Food: 5,000.00 is before the checkpoint month 202609: out.
 */
import { randomUUID } from "node:crypto";
import { groupMovements } from "@retrospend/domain/envelope/inputs-port";
import {
	type RateBookParams,
	type RateRow,
	selectRateRows,
} from "@retrospend/domain/envelope/rate-book";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { prismaBudgetInputs } from "./inputs-source";
import { loadRateRows } from "./rate-book";
import { setupEnvelopeBook } from "./setup.mutation";

const byKey = (g: {
	month: number;
	fromEnvelopeId: string | null;
	toEnvelopeId: string | null;
}) => `${g.month}:${g.fromEnvelopeId ?? "pool"}:${g.toEnvelopeId ?? "pool"}`;

describe("budget inputs port on Postgres", () => {
	let userId: string;
	let bookId: string;
	let food: string;
	let fun: string;

	beforeAll(async () => {
		const s = await seedUser();
		userId = s.user.id;
		await forUser(userId).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: userId },
			include: { envelopes: true },
		});
		bookId = book.id;
		food = book.envelopes.find((e) => e.name === "Rent")?.id as string;
		fun = book.envelopes.find((e) => e.name === "Dining")?.id as string;
		const add = (
			month: number,
			from: string | null,
			to: string | null,
			amount: string,
		) =>
			adminDb.budgetMovement.create({
				data: {
					id: randomUUID(),
					bookId,
					month,
					fromEnvelopeId: from,
					toEnvelopeId: to,
					amount: new Prisma.Decimal(amount),
					kind: "ASSIGN",
					actorUserId: userId,
				},
			});
		await add(202609, null, food, "5000.00");
		for (const a of ["1850000.50", "99.25", "0.25"])
			await add(202610, null, food, a);
		for (let i = 0; i < 3; i++) await add(202610, food, fun, "0.00000001");
		for (let i = 0; i < 11; i++)
			await add(202611, null, food, "99999999999.99999999");
	});

	it("movement sums equal the pure grouping, digit for digit", async () => {
		const afterMonth = 202609;
		const port = await userTransaction(adminDb, userId, (tx) =>
			prismaBudgetInputs(tx, userId, bookId).ownRows({
				from: new Date("2026-10-01T00:00:00Z"),
				afterMonth,
			}),
		);
		const raw = await adminDb.budgetMovement.findMany({ where: { bookId } });
		const pure = groupMovements(
			raw.map((r) => ({
				month: r.month,
				fromEnvelopeId: r.fromEnvelopeId,
				toEnvelopeId: r.toEnvelopeId,
				amount: r.amount.toString(),
			})),
			afterMonth,
		);
		const sort = <
			T extends {
				month: number;
				fromEnvelopeId: string | null;
				toEnvelopeId: string | null;
			},
		>(
			l: T[],
		) => [...l].sort((a, b) => byKey(a).localeCompare(byKey(b)));
		expect(sort(port.movements)).toEqual(sort(pure));
		const sums = Object.fromEntries(
			port.movements.map((g) => [byKey(g), g.amount]),
		);
		expect(sums[`202610:pool:${food}`]).toBe("1850100");
		expect(sums[`202610:${food}:${fun}`]).toBe("0.00000003");
		expect(sums[`202611:pool:${food}`]).toBe("1099999999999.99999989");
		expect(sums[`202609:pool:${food}`]).toBeUndefined();
	});

	describe("rates", () => {
		// XQA stands in for ARS (official, blue, mep), XQJ for JPY: test-only codes.
		const row = (currency: string, type: string, at: string, rate: string) => ({
			currency,
			type,
			date: new Date(at),
			rate: new Prisma.Decimal(rate),
		});
		const P: RateBookParams = {
			bookCurrency: "XQA",
			rateTypes: ["blue", "official"],
			since: "2026-10-01",
			extraCurrencies: ["XQJ"],
		};

		beforeAll(async () => {
			await adminDb.exchangeRate.createMany({
				data: [
					row("XQA", "official", "2026-09-20T00:00:00Z", "1000"),
					row("XQA", "official", "2026-09-30T23:59:59Z", "1050.123456"),
					// Two rows on one day of one pair: the later timestamp is the anchor.
					row("XQA", "card", "2026-09-30T08:00:00Z", "1040"),
					row("XQA", "card", "2026-09-30T20:00:00Z", "1050"),
					row("XQA", "blue", "2026-09-28T00:00:00Z", "1400"),
					row("XQA", "mep", "2026-09-29T00:00:00Z", "1300.5"),
					row("XQA", "blue", "2026-10-01T00:00:00Z", "1500.100000"),
					row("XQA", "blue", "2026-10-10T00:00:00Z", "1520.5"),
					row("XQJ", "official", "2026-09-30T00:00:00Z", "150.25"),
					row("XQJ", "official", "2026-10-12T00:00:00Z", "151"),
				],
				skipDuplicates: true,
			});
		});

		it("the SQL returns the rows the pure selection picks", async () => {
			const sql = await userTransaction(adminDb, userId, (tx) =>
				loadRateRows(tx, P),
			);
			const all = await adminDb.exchangeRate.findMany({
				where: { currency: { in: ["XQA", "XQJ"] } },
			});
			const pure = selectRateRows(
				all.map(
					(r): RateRow => ({
						currency: r.currency,
						type: r.type,
						rate: r.rate.toString(),
						date: r.date.toISOString().slice(0, 10),
						at: r.date.toISOString(),
					}),
				),
				P,
			);
			// Rows of different pairs on one day may come in either order.
			const keyed = (l: RateRow[]) =>
				l.map((r) => `${r.currency}/${r.type}/${r.date}/${r.rate}`).sort();
			expect(keyed(sql)).toEqual(keyed(pure));
			// Anchors before 2026-10-01: official 09-30 (23:59:59 counts as the 30th,
			// not the 20th), blue 09-28, mep 09-29, JPY 09-30; then every row from
			// the 1st on. Trailing zeros of 1500.100000 are gone. The card anchor is
			// the 20:00 row (1050), not the 08:00 one (1040).
			expect(keyed(sql)).toEqual([
				"XQA/blue/2026-09-28/1400",
				"XQA/blue/2026-10-01/1500.1",
				"XQA/blue/2026-10-10/1520.5",
				"XQA/card/2026-09-30/1050",
				"XQA/mep/2026-09-29/1300.5",
				"XQA/official/2026-09-30/1050.123456",
				"XQJ/official/2026-09-30/150.25",
				"XQJ/official/2026-10-12/151",
			]);
			const dates = sql.map((r) => r.date);
			expect(dates).toEqual([...dates].sort());
		});
	});
});
