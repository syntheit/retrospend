/**
 * The band a typed rate stays in, on Postgres, with the rows the payment
 * writes (the database holds the same line: settlement-followups.pg.test.ts).
 *
 * The payment currency is USD, so a rate is USD per 1 unit of the other
 * currency. Fiat is stored per USD, so PLN 4 per USD is 0.25 USD per PLN and
 * the band is 0.05 to 1.25; BGN 3 per USD is 0.333... USD per BGN, band
 * 0.0666... to 1.6666.... The currencies are ones no other test file uses.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { PlannedSettlement } from "./allocate";
import { assertTypedRate, RateOutOfRangeError } from "./rate-band";
import { recordPayment } from "./record.mutation";
import { dec } from "~/server/services/envelope/units";

const DAY = new Date("2026-06-15T00:00:00.000Z");

beforeAll(async () => {
	const rates: [string, string, string, string][] = [
		["2026-05-01", "PLN", "official", "4"],
		["2026-04-01", "CZK", "official", "25"],
		["2026-04-01", "CZK", "blue", "20"],
		["2026-05-01", "BGN", "official", "3"],
	];
	await adminDb.exchangeRate.createMany({
		data: rates.map(([date, currency, type, rate]) => ({
			date: new Date(`${date}T00:00:00.000Z`),
			currency,
			type,
			rate,
		})),
		skipDuplicates: true,
	});
});

/** A row the allocation would write: PLN 100 of debt, cash or offset, at a typed rate. */
const planned = (
	currency: string,
	rate: string | null,
	opts: { isOffset?: boolean; rateType?: string } = {},
): PlannedSettlement => ({
	scope: null,
	currency,
	amount: 10000,
	from: opts.isOffset ? "payee" : "payer",
	isOffset: opts.isOffset ?? false,
	paid: 0,
	quote: rate ? { perUnit: dec(rate), rateType: opts.rateType ?? "custom" } : null,
});

const check = (
	currency: string,
	rate: string,
	rows: PlannedSettlement[],
) =>
	assertTypedRate(adminDb, {
		into: "USD",
		custom: { rate, currency },
		date: DAY,
		planned: rows,
	});

describe("assertTypedRate", () => {
	it("takes a rate from 0.2x to 5x of the stored one", async () => {
		for (const rate of ["0.05", "0.25", "1.25"]) {
			await expect(
				check("PLN", rate, [planned("PLN", rate)]),
			).resolves.toBeUndefined();
		}
	});

	it("refuses a rate outside the band", async () => {
		for (const rate of ["0.04999999", "0.000001", "1.25000001", "100"]) {
			await expect(
				check("PLN", rate, [planned("PLN", rate)]),
			).rejects.toBeInstanceOf(RateOutOfRangeError);
		}
	});

	it("spans the rate types: CZK official 25 and blue 20 give 0.008 to 0.25", async () => {
		await expect(
			check("CZK", "0.008", [planned("CZK", "0.008")]),
		).resolves.toBeUndefined();
		await expect(
			check("CZK", "0.25", [planned("CZK", "0.25")]),
		).resolves.toBeUndefined();
		await expect(
			check("CZK", "0.00799", [planned("CZK", "0.00799")]),
		).rejects.toBeInstanceOf(RateOutOfRangeError);
		await expect(
			check("CZK", "0.2501", [planned("CZK", "0.2501")]),
		).rejects.toBeInstanceOf(RateOutOfRangeError);
	});

	it("holds an offset to the band at the six decimals the row keeps", async () => {
		// BGN 3 per USD: the top of the band is 5 x 0.3333... = 1.6666.... A typed
		// 1.66666666 is inside it, and an offset row stores 1.666667, which is not.
		await expect(
			check("BGN", "1.66666666", [planned("BGN", "1.66666666")]),
		).resolves.toBeUndefined();
		await expect(
			check("BGN", "1.66666666", [
				planned("BGN", "1.66666666", { isOffset: true }),
			]),
		).rejects.toBeInstanceOf(RateOutOfRangeError);
	});

	it("does nothing when the rows did not use the typed rate", async () => {
		await expect(check("PLN", "0.000001", [])).resolves.toBeUndefined();
		await expect(
			check("PLN", "0.000001", [planned("PLN", "0.25", { rateType: "official" })]),
		).resolves.toBeUndefined();
	});

	it("never treats a missing stored rate as 1", async () => {
		// RON has no stored rate. Alone, the typed rate is the payment's own.
		await expect(
			check("RON", "0.22", [planned("RON", "0.22", { isOffset: true })]),
		).resolves.toBeUndefined();
		// Next to another conversion the payment cannot carry it as its rate, which
		// is the only way the database takes an offset with nothing to compare to.
		const mixed = [
			planned("RON", "0.22", { isOffset: true }),
			planned("PLN", "0.25", { rateType: "official" }),
		];
		await expect(check("RON", "0.22", mixed)).rejects.toBeInstanceOf(
			RateOutOfRangeError,
		);
		// Cash rows are not held to the band, so a mix without an offset is fine.
		await expect(
			check("RON", "0.22", [
				planned("RON", "0.22"),
				planned("PLN", "0.25", { rateType: "official" }),
			]),
		).resolves.toBeUndefined();
	});
});

describe("payment.record with a typed rate", () => {
	const ref = (u: Awaited<ReturnType<typeof createTestUser>>) => ({
		participantType: "user" as const,
		participantId: u.user.id,
	});

	/** Ana owes Ben PLN 100, and pays USD 25 at the rate she typed. */
	async function pay(rate: string) {
		const ana = await createTestUser();
		const ben = await createTestUser();
		await adminDb.sharedTransaction.create({
			data: {
				description: "Shared",
				amount: "100",
				currency: "PLN",
				date: new Date("2026-06-10"),
				paidByType: "user",
				paidById: ben.user.id,
				createdByType: "user",
				createdById: ben.user.id,
				splitParticipants: {
					create: [
						{
							...ref(ana),
							shareAmount: "100",
							verificationStatus: "ACCEPTED",
						},
						{ ...ref(ben), shareAmount: "0", verificationStatus: "ACCEPTED" },
					],
				},
			},
		});
		return forUser(ana.user.id).apply(recordPayment, {
			person: ref(ben),
			direction: "outgoing",
			currency: "USD",
			amount: "25",
			customRate: { rate, currency: "PLN" },
			paidOn: "2026-06-15",
		});
	}

	it("records a rate inside the band as the payment's own rate", async () => {
		// 25 USD at 0.25 USD per PLN clears PLN 100.
		const done = await pay("0.25");
		if (!done.value.recorded) throw new Error("not recorded");
		const header = await adminDb.payment.findUniqueOrThrow({
			where: { id: done.value.paymentId },
		});
		expect([header.rateType, header.rate?.toString(), header.rateCurrency]).toEqual([
			"custom",
			"0.25",
			"PLN",
		]);
	});

	it("refuses a rate outside the band, and writes nothing", async () => {
		const before = await adminDb.payment.count();
		await expect(pay("0.000001")).rejects.toBeInstanceOf(RateOutOfRangeError);
		await expect(pay("2")).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("too far from the stored rate"),
		});
		expect(await adminDb.payment.count()).toBe(before);
	});
});
