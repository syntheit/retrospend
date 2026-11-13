/**
 * The rates a payment stores, on a stub transaction: the settlement row keeps
 * the quote at six decimals, the header at twelve, both half to even. ARS home,
 * BRL debts at the blue rate. Pinned before and after the retype to the domain
 * Decimal (money-decimal PR 6a).
 */
import { describe, expect, it, vi } from "vitest";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Prisma } from "~prisma";
import { type Allocation, quote } from "./allocate";
import { confirmationFor } from "./confirmation";
import { writePayment } from "./write";

const payer: ParticipantRef = { participantType: "user", participantId: "ana" };
const payee: ParticipantRef = { participantType: "user", participantId: "ben" };

async function stored(perUnit: string) {
	const allocation: Allocation = {
		currency: "ARS",
		amount: 27_100,
		full: 27_100,
		gross: 27_100,
		everything: true,
		rows: [
			{
				scope: null,
				currency: "BRL",
				amount: 100,
				paid: 27_100,
				quote: quote(perUnit, "blue"),
				excess: false,
			},
		],
		offsets: [],
		remainder: [],
		overpay: 0,
		unpriced: [],
	};
	const header = vi.fn(async (_: { data: { rate: string } }) => ({}));
	const row = vi.fn(async (_: { data: { exchangeRateUsed: string } }) => ({
		id: "row",
	}));
	const tx = {
		payment: { create: header },
		settlement: { create: row },
		auditLogEntry: { create: vi.fn(async () => ({})) },
	} as unknown as Prisma.TransactionClient;
	await writePayment(tx, {
		id: "pay",
		parties: { payer, payee, recorder: payer },
		allocation,
		confirmation: confirmationFor(false, "user"),
		paidOn: new Date("2026-06-15"),
		now: new Date("2026-06-15"),
		paymentMethod: null,
		note: null,
	});
	return {
		header: header.mock.calls[0]?.[0].data.rate,
		row: row.mock.calls[0]?.[0].data.exchangeRateUsed,
	};
}

describe("a payment's stored rates", () => {
	it("271.0000005 BRL blue: the row's 6 dp tie goes to the even 271, the header keeps all digits", async () => {
		expect(await stored("271.0000005")).toEqual({
			row: "271",
			header: "271.0000005",
		});
	});

	it("271.0000015: the row's tie goes up to the even 271.000002", async () => {
		expect((await stored("271.0000015")).row).toBe("271.000002");
	});

	it("271.0000000000005: the header's 12 dp tie goes to the even 271", async () => {
		expect((await stored("271.0000000000005")).header).toBe("271");
	});

	it("271.0000000000015: the header's tie goes up to 271.000000000002", async () => {
		expect((await stored("271.0000000000015")).header).toBe("271.000000000002");
	});
});
