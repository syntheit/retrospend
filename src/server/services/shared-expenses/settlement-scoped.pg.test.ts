/**
 * Settlement record, confirm and reject between two real users, through
 * protectedProcedure. SettlementService runs `ctx.db.$transaction(callback)`
 * without setting the RLS context itself, so these only work (and stay
 * atomic) because the user-scoped client runs the callback on one connection
 * with the context set once.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dayKey } from "@retrospend/domain/time-zone";
import { createCallerFactory } from "~/server/api/trpc";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { settlementRouter } from "../../api/routers/settlement";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const callerFor = (u: TestUser) =>
	createCallerFactory(settlementRouter)({
		session: makeSession({ id: u.user.id }),
		db: adminDb,
		headers: new Headers(),
	});

/** `payer` paid ARS 18,000 and `debtor` owes all of it. */
async function seedDebt(payer: TestUser, debtor: TestUser) {
	await adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount: "18000",
			currency: "ARS",
			date: new Date("2026-10-08"),
			paidByType: "user",
			paidById: payer.user.id,
			createdByType: "user",
			createdById: payer.user.id,
			splitParticipants: {
				create: [
					{
						...ref(debtor),
						shareAmount: "18000",
						verificationStatus: "ACCEPTED",
					},
					{ ...ref(payer), shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

/** What each side sees through its own RLS-scoped client. */
async function seenBy(u: TestUser, paymentId: string) {
	return {
		payment: await u.db.payment.findUnique({ where: { id: paymentId } }),
		rows: await u.db.settlement.findMany({
			where: { paymentGroupId: paymentId },
		}),
	};
}

beforeAll(async () => {
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: today, currency: "ARS", type: "blue" },
		},
		create: { date: today, currency: "ARS", type: "blue", rate: "1355" },
		update: { rate: "1355" },
	});
});

/** The payee fronted ARS 18,000, so the payer owes the payee. */
async function pair() {
	const payer = await createTestUser();
	const payee = await createTestUser();
	for (const u of [payer, payee]) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	}
	await seedDebt(payee, payer);
	return { payer, payee };
}

describe("settlements between two users on the scoped client", () => {
	it("records a payment atomically and both sides see it", async () => {
		const { payer, payee } = await pair();

		const created = await callerFor(payer).create({
			toParticipant: ref(payee),
			amount: 18000,
			currency: "ARS",
		});

		expect(created.requiresPayeeConfirmation).toBe(true);
		const paymentId = created.settlement.paymentGroupId as string;
		for (const side of [payer, payee]) {
			const seen = await seenBy(side, paymentId);
			expect(seen.payment?.status).toBe("PROPOSED");
			expect(seen.payment?.amount.toString()).toBe("18000");
			expect(seen.rows.length).toBeGreaterThan(0);
			expect(seen.rows.every((r) => r.status === "PROPOSED")).toBe(true);
		}
	});

	it("writes nothing when the record is refused", async () => {
		const { payer, payee } = await pair();
		const before = await adminDb.payment.count({
			where: { payerId: payer.user.id },
		});

		await expect(
			callerFor(payer).create({
				toParticipant: ref(payee),
				amount: 99999,
				currency: "ARS",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);

		expect(
			await adminDb.payment.count({ where: { payerId: payer.user.id } }),
		).toBe(before);
	});

	it("confirm turns the whole group FINALIZED for both sides", async () => {
		const { payer, payee } = await pair();
		const created = await callerFor(payer).create({
			toParticipant: ref(payee),
			amount: 18000,
			currency: "ARS",
		});
		const paymentId = created.settlement.paymentGroupId as string;

		await new SettlementService(
			payee.db as never,
			payee.user.id,
		).confirmSettlement(created.settlement.id);

		for (const side of [payer, payee]) {
			const seen = await seenBy(side, paymentId);
			expect(seen.payment?.status).not.toBe("PROPOSED");
			expect(seen.rows.every((r) => r.status === "FINALIZED")).toBe(true);
		}
	});

	it("reject marks the whole group REJECTED for both sides", async () => {
		const { payer, payee } = await pair();
		const created = await callerFor(payer).create({
			toParticipant: ref(payee),
			amount: 18000,
			currency: "ARS",
		});
		const paymentId = created.settlement.paymentGroupId as string;

		await callerFor(payee).reject({
			id: created.settlement.id,
			reason: "not received",
		});

		for (const side of [payer, payee]) {
			const seen = await seenBy(side, paymentId);
			expect(seen.payment?.status).toBe("REJECTED");
			expect(seen.rows.every((r) => r.status === "REJECTED")).toBe(true);
		}
	});
});
