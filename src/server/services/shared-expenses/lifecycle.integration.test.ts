/**
 * Integration Test Suite 1: Full Expense Lifecycle
 *
 * Tests multi-step flows that span SharedTransactionService, VerificationService,
 * and SettlementService using a stateful in-memory mock DB.
 *
 * These tests use the actual service classes (not tRPC routers) to exercise the
 * real business logic paths without needing a real database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Must mock notifications before importing services
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import { computeBalance } from "./balance";
import { SettlementService } from "./settlement.service";
import { createStatefulDb, makeShadowRef, makeUserRef } from "./test-utils";
import { SharedTransactionService } from "./transaction.service";
import { VerificationService } from "./verification.service";

// ── helpers ───────────────────────────────────────────────────────────────────

const ALICE = "alice";
const BOB = "bob";
const aliceRef = makeUserRef(ALICE);
const bobRef = makeUserRef(BOB);

function makeCreateInput(
	overrides: {
		amount?: number;
		currency?: string;
		description?: string;
		paidBy?: {
			participantType: "user" | "shadow" | "guest";
			participantId: string;
		};
		splitWith?: Array<{
			participantType: "user" | "shadow" | "guest";
			participantId: string;
			shareAmount?: number;
		}>;
		splitMode?: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
	} = {},
) {
	return {
		amount: overrides.amount ?? 100,
		currency: overrides.currency ?? "USD",
		description: overrides.description ?? "Dinner",
		date: new Date("2026-03-01"),
		paidBy: overrides.paidBy ?? aliceRef,
		splitWith: overrides.splitWith ?? [aliceRef, bobRef],
		splitMode: overrides.splitMode ?? ("EQUAL" as const),
	};
}

// ── Suite 1A: Create → Accept → Settle → Confirm → Zero balance ───────────────

describe("Suite 1A: Full expense lifecycle: happy path", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("step 1: alice creates expense split equally with bob", async () => {
		const service = new SharedTransactionService(db as never, aliceRef);

		const result = await service.create(makeCreateInput());

		// Service returns { transaction, backdatedWarning }
		expect(result.transaction).toBeDefined();
		expect(result.backdatedWarning).toBeNull();

		const { transaction } = result;
		expect(transaction.splitParticipants).toHaveLength(2);

		const aliceSplit = transaction.splitParticipants.find(
			(sp: { participantId: string }) => sp.participantId === ALICE,
		);
		const bobSplit = transaction.splitParticipants.find(
			(sp: { participantId: string }) => sp.participantId === BOB,
		);

		// Payer (alice) is auto-ACCEPTED; non-payer (bob) is PENDING
		expect(aliceSplit?.verificationStatus).toBe("ACCEPTED");
		expect(bobSplit?.verificationStatus).toBe("PENDING");

		// Equal split: each gets $50
		expect(aliceSplit?.shareAmount).toBe(50);
		expect(bobSplit?.shareAmount).toBe(50);

		// Audit log entry was created
		expect(db._stores.audits).toHaveLength(1);
		expect(db._stores.audits[0]).toMatchObject({ action: "CREATED" });
	});

	it("step 2: bob accepts the expense; computedStatus becomes active", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		const accepted = await verifyService.accept(transaction.id);

		expect(accepted.computedStatus).toBe("active");
		expect(
			accepted.splitParticipants.every(
				(sp: { verificationStatus: string }) =>
					sp.verificationStatus === "ACCEPTED",
			),
		).toBe(true);

		// Audit entry for VERIFIED
		const verifyAudit = db._stores.audits.find(
			(a: unknown) => (a as { action: string }).action === "VERIFIED",
		);
		expect(verifyAudit).toBeDefined();
	});

	it("step 2b: bob accepting an already-accepted split is idempotent", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		const first = await verifyService.accept(transaction.id);
		const second = await verifyService.accept(transaction.id);

		// Both calls succeed and return active status
		expect(first.computedStatus).toBe("active");
		expect(second.computedStatus).toBe("active");
	});

	it("step 3: unconfirmed settlement does NOT affect balance (PROPOSED is ignored)", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		// Bob accepts
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Bob initiates a settlement toward alice (PROPOSED, not yet confirmed)
		// We manually insert a PROPOSED settlement to verify it's excluded from balance
		db._stores.settlements.set("settle-proposed", {
			id: "settle-proposed",
			fromParticipantType: "user",
			fromParticipantId: BOB,
			toParticipantType: "user",
			toParticipantId: ALICE,
			amount: 50,
			currency: "USD",
			status: "PROPOSED", // NOT FINALIZED
			confirmedByPayer: true,
			confirmedByPayee: false,
			initiatedAt: new Date(),
			settledAt: null,
			convertedAmount: null,
			convertedCurrency: null,
			exchangeRateUsed: null,
			paymentMethod: null,
			note: null,
		});

		// Balance should still show bob owes alice $50
		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency).toEqual({ USD: 50 });
	});

	it("step 4: bob initiates settlement, alice confirms; balance becomes zero", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Pre-settlement balance: alice is owed $50
		const balanceBefore = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceBefore.byCurrency).toEqual({ USD: 50 });

		// Bob settles: he owes alice, so from=bob to=alice
		// But SettlementService uses "currentUserId" as the initiator (FROM person)
		// Bob is initiating settlement (paying alice)
		const settlementService = new SettlementService(db as never, BOB);
		const { settlement, warning } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});

		expect(settlement.status).toBe("PROPOSED");
		expect(settlement.confirmedByPayer).toBe(true);
		expect(settlement.confirmedByPayee).toBe(false);
		// No over-settlement warning (bob owes exactly $50)
		expect(warning).toBeNull();

		// Balance still shows bob owes $50 because settlement is PROPOSED, not FINALIZED
		const balanceDuring = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceDuring.byCurrency).toEqual({ USD: 50 });

		// Alice confirms receipt of payment
		const aliceSettlementService = new SettlementService(db as never, ALICE);
		const confirmed = await aliceSettlementService.confirmSettlement(
			settlement.id,
		);

		expect(confirmed.status).toBe("FINALIZED");
		expect(confirmed.settledAt).toBeInstanceOf(Date);
		expect(confirmed.confirmedByPayee).toBe(true);

		// Post-settlement balance should be zero
		const balanceAfter = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceAfter.byCurrency).toEqual({});
	});

	it("partial settlement: balance reduces but doesn't reach zero", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Bob settles only $30 of the $50 owed
		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 30,
			currency: "USD",
		});
		const aliceSettlementService = new SettlementService(db as never, ALICE);
		await aliceSettlementService.confirmSettlement(settlement.id);

		// Bob still owes alice $20
		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency).toEqual({ USD: 20 });
	});

	it("over-settlement: settlement warns when exceeding the balance", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Bob tries to settle $60 when only $50 is owed
		const settlementService = new SettlementService(db as never, BOB);
		const { settlement, warning } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 60,
			currency: "USD",
		});

		expect(settlement).toBeDefined();
		expect(warning).toBeTruthy();
		expect(warning).toContain("10.00"); // $10 excess
	});
});

// ── Suite 1B: Rejection flow ──────────────────────────────────────────────────

describe("Suite 1B: Rejection flow: reject -> edit -> re-accept", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("bob rejects the expense; status is disputed, reason stored", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		const rejected = await verifyService.reject(
			transaction.id,
			"Amount looks wrong",
		);

		expect(rejected.computedStatus).toBe("disputed");

		const bobSplit = rejected.splitParticipants.find(
			(sp: { participantId: string }) => sp.participantId === BOB,
		);
		expect(bobSplit?.verificationStatus).toBe("REJECTED");
		expect(bobSplit?.rejectionReason).toBe("Amount looks wrong");

		// rejectionPendingNotification flag is set
		expect(rejected.rejectionPendingNotification).toBe(true);
		expect(rejected.rejectionNotificationTarget).toMatchObject({
			type: "user",
			id: ALICE,
		});

		// Audit entry for REJECTED
		const rejectAudit = db._stores.audits.find(
			(a: unknown) => (a as { action: string }).action === "REJECTED",
		);
		expect(rejectAudit).toBeDefined();
	});

	it("bob rejecting an already-rejected split is idempotent", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.reject(transaction.id, "first rejection");
		const second = await verifyService.reject(
			transaction.id,
			"second rejection",
		);

		// Second rejection returns without error, rejectionPendingNotification=false
		expect(second.computedStatus).toBe("disputed");
		expect(second.rejectionPendingNotification).toBe(false);
	});

	it("alice edits the expense; bob's status resets to PENDING", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.reject(transaction.id, "Amount looks wrong");

		// Alice edits the description (not splits)
		const updated = await txService.update({
			id: transaction.id,
			description: "Dinner: corrected",
		});

		// Bob should be back to PENDING
		const bobSplit = (
			updated as {
				splitParticipants: Array<{
					participantId: string;
					verificationStatus: string;
				}>;
			}
		).splitParticipants.find((sp) => sp.participantId === BOB);
		expect(bobSplit?.verificationStatus).toBe("PENDING");

		// Alice's own split should remain ACCEPTED (the editor's split isn't reset)
		const aliceSplit = (
			updated as {
				splitParticipants: Array<{
					participantId: string;
					verificationStatus: string;
				}>;
			}
		).splitParticipants.find((sp) => sp.participantId === ALICE);
		expect(aliceSplit?.verificationStatus).toBe("ACCEPTED");

		// Audit entry for EDITED
		const editAudit = db._stores.audits.find(
			(a: unknown) => (a as { action: string }).action === "EDITED",
		);
		expect(editAudit).toBeDefined();
	});

	it("alice edits with new splits; old split participants are replaced, bob is PENDING", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.reject(transaction.id, "Amount looks wrong");

		// Alice updates with new amount AND new splits
		await txService.update({
			id: transaction.id,
			amount: 80,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
		});

		// Verify new split amounts in the DB
		const newSplits = [...db._stores.splits.values()].filter(
			(sp) => sp.transactionId === transaction.id,
		);
		expect(newSplits).toHaveLength(2);
		expect(newSplits.every((sp) => sp.shareAmount === 40)).toBe(true);

		// Bob's status is PENDING
		const bobSplit = newSplits.find((sp) => sp.participantId === BOB);
		expect(bobSplit?.verificationStatus).toBe("PENDING");
	});

	it("bob accepts the revised expense; computedStatus becomes active", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.reject(transaction.id, "wrong amount");

		// Alice edits
		await txService.update({
			id: transaction.id,
			description: "Dinner (corrected)",
		});

		// Bob re-accepts
		const accepted = await verifyService.accept(transaction.id);
		expect(accepted.computedStatus).toBe("active");
	});

	it("non-participant cannot verify the expense: FORBIDDEN", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const carolRef = makeUserRef("carol");
		const carolService = new VerificationService(db as never, carolRef);

		await expect(carolService.accept(transaction.id)).rejects.toThrow(
			"You are not a participant on this transaction",
		);
	});

	it("non-creator cannot edit the expense: FORBIDDEN", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const bobTxService = new SharedTransactionService(db as never, bobRef);
		await expect(
			bobTxService.update({ id: transaction.id, description: "Bob's edit" }),
		).rejects.toThrow("Only the creator can edit this expense");
	});

	it("non-creator cannot delete the expense: FORBIDDEN", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const bobTxService = new SharedTransactionService(db as never, bobRef);
		await expect(bobTxService.delete(transaction.id)).rejects.toThrow(
			"Only the creator can edit this expense",
		);
	});
});

// ── Suite 1C: Locked transactions ────────────────────────────────────────────

describe("Suite 1C: Locked transactions cannot be edited or deleted", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("editing a locked transaction throws FORBIDDEN", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		// Manually lock the transaction (simulates settling a billing period)
		const tx = db._stores.transactions.get(transaction.id)!;
		db._stores.transactions.set(transaction.id, { ...tx, isLocked: true });

		await expect(
			txService.update({ id: transaction.id, description: "Attempt edit" }),
		).rejects.toThrow("Settled transactions cannot be modified");
	});

	it("deleting a locked transaction throws FORBIDDEN", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const tx = db._stores.transactions.get(transaction.id)!;
		db._stores.transactions.set(transaction.id, { ...tx, isLocked: true });

		await expect(txService.delete(transaction.id)).rejects.toThrow(
			"Settled transactions cannot be modified",
		);
	});

	it("locked transaction still contributes to balance computation", async () => {
		// Lock doesn't exclude from financial calculations
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Lock the transaction
		const tx = db._stores.transactions.get(transaction.id)!;
		db._stores.transactions.set(transaction.id, { ...tx, isLocked: true });

		// Balance should still reflect the locked transaction
		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency).toEqual({ USD: 50 });
	});
});

// ── Suite 1D: Multi-currency flows ────────────────────────────────────────────

describe("Suite 1D: Multi-currency balances", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("two currencies tracked independently; settling one doesn't affect the other", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);

		// Alice pays $100 USD split with bob
		const usdResult = await txService.create(
			makeCreateInput({ amount: 100, currency: "USD" }),
		);
		// Alice pays ARS 5000 split with bob
		const arsResult = await txService.create(
			makeCreateInput({ amount: 5000, currency: "ARS" }),
		);

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(usdResult.transaction.id);
		await verifyService.accept(arsResult.transaction.id);

		// Confirm balance in both currencies
		const balanceBefore = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceBefore.byCurrency.USD).toBe(50);
		expect(balanceBefore.byCurrency.ARS).toBe(2500);

		// Settle USD only
		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});
		const aliceSettleService = new SettlementService(db as never, ALICE);
		await aliceSettleService.confirmSettlement(settlement.id);

		// USD settled, ARS still outstanding
		const balanceAfter = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceAfter.byCurrency.USD).toBeUndefined();
		expect(balanceAfter.byCurrency.ARS).toBe(2500);
	});
});

// ── Suite 1E: Shadow profile participants ────────────────────────────────────

describe("Suite 1E: Shadow profile participants", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
		// Set up a shadow profile accessible to alice
		db._stores.shadowProfiles.set("shadow-marcus", {
			id: "shadow-marcus",
			name: "Marcus",
			email: null,
			phone: null,
			createdById: ALICE,
			claimedById: null,
		});
	});

	it("alice can create an expense split with a shadow profile", async () => {
		const marcusRef = makeShadowRef("shadow-marcus");
		const txService = new SharedTransactionService(db as never, aliceRef);

		const result = await txService.create(
			makeCreateInput({
				splitWith: [aliceRef, marcusRef],
			}),
		);

		expect(result.transaction.splitParticipants).toHaveLength(2);
		const marcusSplit = result.transaction.splitParticipants.find(
			(sp: { participantId: string }) => sp.participantId === "shadow-marcus",
		);
		// Shadow profiles start PENDING (they can't verify themselves)
		expect(marcusSplit?.verificationStatus).toBe("PENDING");
	});

	it("alice can settle with a shadow profile", async () => {
		const marcusRef = makeShadowRef("shadow-marcus");
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create(
			makeCreateInput({ splitWith: [aliceRef, marcusRef] }),
		);

		// Alice settles on behalf of marcus
		const settlementService = new SettlementService(db as never, ALICE);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: marcusRef,
			amount: 50,
			currency: "USD",
		});

		// Shadow profiles can't confirm, but the settlement was created
		expect(settlement.toParticipantType).toBe("shadow");
		expect(settlement.toParticipantId).toBe("shadow-marcus");
	});

	it("settlement with non-existent shadow profile throws", async () => {
		const bogusRef = makeShadowRef("does-not-exist");
		// db.shadowProfile.findUnique returns null for unknown id
		const settlementService = new SettlementService(db as never, ALICE);

		await expect(
			settlementService.initiateSettlement({
				toParticipant: bogusRef,
				amount: 50,
				currency: "USD",
			}),
		).rejects.toThrow("Person not found");
	});
});

// ── Suite 1F: Concurrent verification ────────────────────────────────────────

describe("Suite 1F: Concurrent verification: two users accept simultaneously", () => {
	it("both users accepting in parallel both succeed", async () => {
		const db = createStatefulDb();

		const carolRef = makeUserRef("carol");
		const txService = new SharedTransactionService(db as never, aliceRef);

		// 3-way split: alice (creator), bob, carol
		const { transaction } = await txService.create(
			makeCreateInput({ splitWith: [aliceRef, bobRef, carolRef] }),
		);

		// Simulate concurrent acceptance
		const bobService = new VerificationService(db as never, bobRef);
		const carolService = new VerificationService(db as never, carolRef);

		const [bobResult, carolResult] = await Promise.all([
			bobService.accept(transaction.id),
			carolService.accept(transaction.id),
		]);

		// Both succeed
		expect(bobResult.computedStatus).toBe("active");
		expect(carolResult.computedStatus).toBe("active");

		// All participants now ACCEPTED
		expect(
			carolResult.splitParticipants.every(
				(sp: { verificationStatus: string }) =>
					sp.verificationStatus === "ACCEPTED",
			),
		).toBe(true);
	});
});

// ── Suite 1G: Immediate deletion ─────────────────────────────────────────────

describe("Suite 1G: Create then immediately delete", () => {
	it("clean deletion before any verification; no orphaned splits", async () => {
		const db = createStatefulDb();
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		// Splits were created
		expect(db._stores.splits.size).toBe(2);

		// Delete immediately
		await txService.delete(transaction.id);

		// Transaction and all splits are gone
		expect(db._stores.transactions.size).toBe(0);
		expect(db._stores.splits.size).toBe(0);

		// Audit log has CREATED and DELETED entries
		const actions = (db._stores.audits as Array<{ action: string }>).map(
			(a) => a.action,
		);
		expect(actions).toContain("CREATED");
		expect(actions).toContain("DELETED");
	});
});

// ── Suite 1H: Settlement validation ──────────────────────────────────────────

describe("Suite 1H: Settlement edge cases", () => {
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("settlement with no prior shared transactions throws", async () => {
		const settlementService = new SettlementService(db as never, BOB);

		await expect(
			settlementService.initiateSettlement({
				toParticipant: aliceRef,
				amount: 50,
				currency: "USD",
			}),
		).rejects.toThrow("No financial relationship found");
	});

	it("cannot confirm a settlement if you are not the payee", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create(makeCreateInput());

		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});

		// Bob tries to confirm his own settlement (he's the payer, not payee)
		const bobSettleService = new SettlementService(db as never, BOB);
		await expect(
			bobSettleService.confirmSettlement(settlement.id),
		).rejects.toThrow("Only the payee can confirm");
	});

	it("cannot confirm an already-confirmed settlement", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create(makeCreateInput());

		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});

		const aliceSettleService = new SettlementService(db as never, ALICE);
		await aliceSettleService.confirmSettlement(settlement.id); // First confirm

		await expect(
			aliceSettleService.confirmSettlement(settlement.id),
		).rejects.toThrow("already confirmed");
	});

	it("payer can delete a pending (PROPOSED) settlement", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create(makeCreateInput());

		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});

		const result = await settlementService.deletePendingSettlement(
			settlement.id,
		);
		expect(result).toEqual({ success: true });
		expect(db._stores.settlements.size).toBe(0);
	});

	it("confirmed settlement cannot be deleted", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create(makeCreateInput());

		const settlementService = new SettlementService(db as never, BOB);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: aliceRef,
			amount: 50,
			currency: "USD",
		});

		const aliceSettleService = new SettlementService(db as never, ALICE);
		await aliceSettleService.confirmSettlement(settlement.id);

		await expect(
			settlementService.deletePendingSettlement(settlement.id),
		).rejects.toThrow("Cannot delete a confirmed settlement");
	});
});
