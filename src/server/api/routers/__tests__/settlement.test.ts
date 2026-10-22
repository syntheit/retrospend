/**
 * Settlement Authorization Tests
 *
 * Tests SettlementService directly (not through tRPC), on the stateful
 * in-memory DB, to verify:
 * - Only the payee can confirm a settlement
 * - Only the payer can delete a pending settlement
 * - Only auto-finalized payments to a shadow or guest can be voided
 * - Self-settlements are rejected
 * - Confirmed settlements are immutable
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import {
	addShadowProfile,
	createStatefulDb,
	makeGuestRef,
	makeUserRef,
} from "~/server/services/shared-expenses/test-utils";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";

const PAYER = "payer-user";
const PAYEE = "payee-user";
const payerRef = makeUserRef(PAYER);
const payeeRef = makeUserRef(PAYEE);

let db: ReturnType<typeof createStatefulDb>;

/** The payer owes `to` 100 USD on one shared expense. */
function seedDebt(to: ParticipantRef) {
	const txId = `tx-${db._stores.transactions.size + 1}`;
	db._stores.transactions.set(txId, {
		id: txId,
		description: "Dinner",
		amount: 100,
		currency: "USD",
		date: new Date("2026-03-10"),
		paidByType: to.participantType,
		paidById: to.participantId,
		createdByType: to.participantType,
		createdById: to.participantId,
		splitMode: "EXACT",
		projectId: null,
		billingPeriodId: null,
		isLocked: false,
		notes: null,
		receiptUrl: null,
		categoryId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	for (const [ref, share] of [
		[payerRef, 100],
		[to, 0],
	] as const) {
		const id = `sp-${db._stores.splits.size + 1}`;
		db._stores.splits.set(id, {
			id,
			transactionId: txId,
			participantType: ref.participantType,
			participantId: ref.participantId,
			shareAmount: share,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "ACCEPTED",
			verifiedAt: new Date(),
			rejectionReason: null,
			hasUnseenChanges: false,
		});
	}
}

const as = (userId: string) => new SettlementService(db as never, userId);

async function pay(to: ParticipantRef = payeeRef) {
	seedDebt(to);
	const { settlement } = await as(PAYER).initiateSettlement({
		toParticipant: to,
		amount: 50,
		currency: "USD",
	});
	return settlement.id;
}

beforeEach(() => {
	db = createStatefulDb();
});

describe("SettlementService.confirmSettlement", () => {
	it("payee can confirm settlement", async () => {
		const id = await pay();
		const result = await as(PAYEE).confirmSettlement(id);
		expect(result).toMatchObject({ status: "FINALIZED", confirmedByPayee: true });
	});

	it("payer and third parties cannot confirm", async () => {
		const id = await pay();
		await expect(as(PAYER).confirmSettlement(id)).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(as("random-user").confirmSettlement(id)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("already-confirmed settlement throws BAD_REQUEST, a missing one NOT_FOUND", async () => {
		const id = await pay();
		await as(PAYEE).confirmSettlement(id);
		await expect(as(PAYEE).confirmSettlement(id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(as(PAYEE).confirmSettlement("missing-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("SettlementService.deletePendingSettlement", () => {
	it("payer can delete their pending settlement", async () => {
		const id = await pay();
		expect(await as(PAYER).deletePendingSettlement(id)).toEqual({ success: true });
		expect(db._stores.settlements.size).toBe(0);
		expect(db._stores.payments.size).toBe(0);
	});

	it("payee cannot delete it, and a confirmed one cannot be deleted", async () => {
		const id = await pay();
		await expect(as(PAYEE).deletePendingSettlement(id)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await as(PAYEE).confirmSettlement(id);
		await expect(as(PAYER).deletePendingSettlement(id)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(as(PAYER).deletePendingSettlement("ghost-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("SettlementService.voidAutoFinalizedSettlement", () => {
	it("payer can void an auto-finalized shadow or guest settlement (hard delete)", async () => {
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: addShadowProfile(db, { createdById: PAYER, name: "Ghost" }).id,
		};
		for (const to of [shadow, makeGuestRef("guest-1")]) {
			const id = await pay(to);
			expect(await as(PAYER).voidAutoFinalizedSettlement(id)).toEqual({ success: true });
		}
		expect(db._stores.settlements.size).toBe(0);
		expect(db._stores.payments.size).toBe(0);
	});

	it("non-payer cannot void, nor anyone a payment to a real user", async () => {
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: addShadowProfile(db, { createdById: PAYER, name: "Ghost" }).id,
		};
		const toShadow = await pay(shadow);
		await expect(as("someone-else").voidAutoFinalizedSettlement(toShadow)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		// Pending: delete it instead. Confirmed by a real user: protected.
		const toUser = await pay(payeeRef);
		await expect(as(PAYER).voidAutoFinalizedSettlement(toUser)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await as(PAYEE).confirmSettlement(toUser);
		await expect(as(PAYER).voidAutoFinalizedSettlement(toUser)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(as(PAYER).voidAutoFinalizedSettlement("ghost-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(db._stores.settlements.size).toBe(2);
	});
});

describe("SettlementService.initiateSettlement", () => {
	it("self-settlement is rejected with BAD_REQUEST", async () => {
		seedDebt(payeeRef);
		await expect(
			as(PAYER).initiateSettlement({ toParticipant: payerRef, amount: 50, currency: "USD" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("normal creation succeeds and sets confirmedByPayer=true", async () => {
		const id = await pay();
		expect(db._stores.settlements.get(id)).toMatchObject({
			confirmedByPayer: true,
			confirmedByPayee: false,
		});
	});
});
