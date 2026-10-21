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

import { computeBalance, computeBalanceByProject } from "./balance";
import { computeSettlementPlan, isFullySettled } from "./group-settlement";
import { canonicalizeProjectLedger } from "./identity";
import { SettlementService } from "./settlement.service";
import {
	addProject,
	addProjectParticipant,
	createStatefulDb,
	makeShadowRef,
	makeUserRef,
} from "./test-utils";
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
		projectId?: string;
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
		...(overrides.projectId ? { projectId: overrides.projectId } : {}),
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

		// Payer (alice) is ACCEPTED. This is a standalone expense, so it
		// auto-accepts: bob is AUTO_ACCEPTED, not PENDING. Manual PENDING approval
		// only applies inside a project that has auto-accept turned off.
		expect(aliceSplit?.verificationStatus).toBe("ACCEPTED");
		expect(bobSplit?.verificationStatus).toBe("AUTO_ACCEPTED");

		// Equal split: each gets $50
		expect(aliceSplit?.shareAmount).toBe(50);
		expect(bobSplit?.shareAmount).toBe(50);

		// Audit log entry was created
		expect(db._stores.audits).toHaveLength(1);
		expect(db._stores.audits[0]).toMatchObject({ action: "CREATED" });
	});

	it("step 2: standalone expense is active on create; bob accepting is idempotent", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		// A standalone expense auto-accepts, so it is already active before bob
		// does anything: bob's split is AUTO_ACCEPTED, not PENDING.
		const verifyService = new VerificationService(db as never, bobRef);
		const accepted = await verifyService.accept(transaction.id);

		expect(accepted.computedStatus).toBe("active");
		// Every split is in an accepted state (the payer ACCEPTED, others
		// AUTO_ACCEPTED). Bob accepting an already-accepted split is a no-op.
		expect(
			accepted.splitParticipants.every(
				(sp: { verificationStatus: string }) =>
					sp.verificationStatus === "ACCEPTED" ||
					sp.verificationStatus === "AUTO_ACCEPTED",
			),
		).toBe(true);

		// No VERIFIED audit entry: bob's split was already auto-accepted, so accept
		// short-circuits without recording a manual verification.
		const verifyAudit = db._stores.audits.find(
			(a: unknown) => (a as { action: string }).action === "VERIFIED",
		);
		expect(verifyAudit).toBeUndefined();
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

	it("step 3: a PROPOSED settlement reduces the balance optimistically", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());

		// Bob accepts (standalone expense is already auto-accepted; idempotent)
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Bob owes alice $50 before any settlement.
		const before = await computeBalance(db as never, aliceRef, bobRef);
		expect(before.byCurrency).toEqual({ USD: 50 });

		// Bob proposes a PARTIAL settlement toward alice (PROPOSED, not confirmed).
		// PROPOSED settlements now count optimistically, so the displayed balance
		// drops immediately rather than waiting for the payee to confirm.
		db._stores.settlements.set("settle-proposed", {
			id: "settle-proposed",
			fromParticipantType: "user",
			fromParticipantId: BOB,
			toParticipantType: "user",
			toParticipantId: ALICE,
			amount: 30,
			currency: "USD",
			status: "PROPOSED",
			confirmedByPayer: true,
			confirmedByPayee: false,
			initiatedAt: new Date(),
			settledAt: null,
			convertedAmount: null,
			convertedCurrency: null,
			exchangeRateUsed: null,
			paymentMethod: null,
			note: null,
			projectId: null,
		});

		// $50 owed minus the $30 optimistic settlement leaves $20.
		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency).toEqual({ USD: 20 });
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

		// The PROPOSED settlement already counts optimistically, so the displayed
		// balance drops to zero right away (before the payee confirms).
		const balanceDuring = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceDuring.byCurrency).toEqual({});

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

	it("over-settlement is blocked: settling more than owed is rejected", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(makeCreateInput());
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Bob tries to settle $60 when only $50 is owed. Over-payment is now hard
		// blocked (not just warned) because recording it would fabricate a reverse
		// debt against the recipient.
		const settlementService = new SettlementService(db as never, BOB);
		await expect(
			settlementService.initiateSettlement({
				toParticipant: aliceRef,
				amount: 60,
				currency: "USD",
			}),
		).rejects.toThrow("exceeds the outstanding balance");

		// No settlement record was written.
		expect(db._stores.settlements.size).toBe(0);
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

	it("alice edits the expense in a manual-approval project; bob's status resets to PENDING", async () => {
		// Reset-to-PENDING on edit only happens when the project requires manual
		// approval (autoAcceptSplits off). In an auto-accept project or a standalone
		// expense, an edit re-accepts non-actor splits automatically instead.
		const project = addProject(db, {
			createdById: ALICE,
			autoAcceptSplits: false,
		});
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "user",
			participantId: ALICE,
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "user",
			participantId: BOB,
			role: "CONTRIBUTOR",
		});

		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(
			makeCreateInput({ projectId: project.id }),
		);

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

	it("alice edits with new splits in a manual-approval project; old splits are replaced, bob is PENDING", async () => {
		// As above, resetting bob to PENDING on edit requires a manual-approval
		// project; a standalone/auto-accept expense would AUTO_ACCEPT the new split.
		const project = addProject(db, {
			createdById: ALICE,
			autoAcceptSplits: false,
		});
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "user",
			participantId: ALICE,
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: "user",
			participantId: BOB,
			role: "CONTRIBUTOR",
		});

		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create(
			makeCreateInput({ projectId: project.id }),
		);

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
		// A shadow (ghost) is ALWAYS AUTO_ACCEPTED: it has no account or session and
		// can never tap "accept", so leaving it PENDING would strand the split forever.
		expect(marcusSplit?.verificationStatus).toBe("AUTO_ACCEPTED");
	});

	it("alice can settle a debt she owes a shadow profile", async () => {
		const marcusRef = makeShadowRef("shadow-marcus");
		const txService = new SharedTransactionService(db as never, aliceRef);
		// Marcus (the shadow) paid, so alice owes marcus her $50 share. Alice can
		// then record paying marcus back. (Alice cannot record a payment TO marcus
		// when marcus owes HER: that would over-settle and is now blocked.)
		await txService.create(
			makeCreateInput({ paidBy: marcusRef, splitWith: [aliceRef, marcusRef] }),
		);

		// Alice records that she paid marcus back.
		const settlementService = new SettlementService(db as never, ALICE);
		const { settlement } = await settlementService.initiateSettlement({
			toParticipant: marcusRef,
			amount: 50,
			currency: "USD",
		});

		// A shadow can't confirm, so the settlement auto-finalizes on creation.
		expect(settlement.toParticipantType).toBe("shadow");
		expect(settlement.toParticipantId).toBe("shadow-marcus");
		expect(settlement.status).toBe("FINALIZED");
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

		// All participants are in an accepted state (the standalone expense
		// auto-accepts, so non-payers are AUTO_ACCEPTED; the payer is ACCEPTED).
		expect(
			carolResult.splitParticipants.every(
				(sp: { verificationStatus: string }) =>
					sp.verificationStatus === "ACCEPTED" ||
					sp.verificationStatus === "AUTO_ACCEPTED",
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

		// Delete immediately. The fresh expense has an unsettled balance, so
		// acknowledge it; this test verifies clean cascade deletion, not the guard.
		await txService.delete(transaction.id, true);

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

// ── Suite 1I: Project-scoped settlements (real computeBalance) ────────────────
//
// Uses the real computeBalance + stateful DB to verify that a project-scoped
// settle-up acts on the SAME per-project balance the UI shows: it clears the
// scoped balance, leaves other projects untouched, and still reduces the global
// cross-project rollup by exactly the settled amount.

describe("Suite 1I: Project-scoped settlements", () => {
	let db: ReturnType<typeof createStatefulDb>;

	// Seed a project-scoped shared transaction directly into the stores: bob owes
	// alice `bobShare` in `projectId` (alice paid). Bypasses the project-setup
	// machinery of SharedTransactionService.create to keep the test focused on
	// balance scoping. Both alice and bob are split participants (alice's own
	// share is 0 so it does not affect the pairwise balance) so the settlement
	// relationship check passes.
	function seedBobOwesAlice(projectId: string | null, bobShare: number) {
		const txId = `tx-${db._stores.transactions.size + 1}`;
		db._stores.transactions.set(txId, {
			id: txId,
			description: "Shared expense",
			amount: bobShare,
			currency: "USD",
			date: new Date("2026-03-01"),
			paidByType: "user",
			paidById: ALICE,
			createdByType: "user",
			createdById: ALICE,
			splitMode: "EXACT",
			projectId,
			billingPeriodId: null,
			isLocked: false,
			notes: null,
			receiptUrl: null,
			categoryId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const addSplit = (participantId: string, shareAmount: number) => {
			const spId = `sp-${db._stores.splits.size + 1}`;
			db._stores.splits.set(spId, {
				id: spId,
				transactionId: txId,
				participantType: "user",
				participantId,
				shareAmount,
				sharePercentage: null,
				shareUnits: null,
				verificationStatus: "ACCEPTED",
				verifiedAt: new Date(),
				rejectionReason: null,
				hasUnseenChanges: false,
			});
		};
		addSplit(BOB, bobShare);
		addSplit(ALICE, 0);
	}

	// Alice paid for bob: the reverse direction (alice owes bob `aliceShare`).
	function seedAliceOwesBob(projectId: string | null, aliceShare: number) {
		seedBobOwesAlice(projectId, 0);
		const txId = `tx-${db._stores.transactions.size}`;
		const tx = db._stores.transactions.get(txId)!;
		db._stores.transactions.set(txId, {
			...tx,
			amount: aliceShare,
			paidById: BOB,
			createdById: BOB,
		});
		for (const [id, sp] of db._stores.splits) {
			if (sp.transactionId !== txId) continue;
			db._stores.splits.set(id, {
				...sp,
				shareAmount: sp.participantId === ALICE ? aliceShare : 0,
			});
		}
	}

	const settlementRows = () =>
		[...db._stores.settlements.values()].map((s) => ({
			projectId: s.projectId,
			amount: Number(s.amount),
		}));

	beforeEach(() => {
		db = createStatefulDb();
		// alice, bob and the shadow used below participate in projects A and B.
		for (const projectId of ["A", "B"]) {
			for (const [participantType, participantId] of [
				["user", ALICE],
				["user", BOB],
				["shadow", "shadow-x"],
			] as const) {
				addProjectParticipant(db, {
					projectId,
					participantType,
					participantId,
					role: "EDITOR",
				});
			}
		}
	});

	it("settling within project A clears A, leaves B untouched, and reduces the global rollup by the settled amount", async () => {
		// bob owes alice $40 in project A and $10 in project B.
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice("B", 10);

		// Bob settles the full project-A balance ($40), scoped to project A.
		const bobSettle = new SettlementService(db as never, BOB);
		const { settlement } = await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 40,
			currency: "USD",
			projectId: "A",
		});
		// Row stamped with the project.
		expect(db._stores.settlements.get(settlement.id)?.projectId).toBe("A");

		// Confirm so it FINALIZES (a user payee must confirm).
		const aliceSettle = new SettlementService(db as never, ALICE);
		await aliceSettle.confirmSettlement(settlement.id);

		// Project A is now cleared.
		const balanceA = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(balanceA.byCurrency.USD ?? 0).toBe(0);

		// Project B is untouched: bob still owes alice $10.
		const balanceB = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "B",
		});
		expect(balanceB.byCurrency).toEqual({ USD: 10 });

		// Global rollup reduced by exactly the settled $40: 50 - 40 = 10.
		const balanceGlobal = await computeBalance(db as never, aliceRef, bobRef);
		expect(balanceGlobal.byCurrency).toEqual({ USD: 10 });
	});

	it("over-payment cap is project-scoped: cannot settle more than the project balance", async () => {
		// bob owes alice $40 in project A and $100 in project B. The global debt is
		// $140, but a project-A settle-up may not exceed $40.
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice("B", 100);

		const bobSettle = new SettlementService(db as never, BOB);
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 60, // > project-A balance ($40), though < global ($140)
				currency: "USD",
				projectId: "A",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);
		expect(db._stores.settlements.size).toBe(0);
	});

	it("global entry (no projectId) writes a project-less settlement row (projectId=null)", async () => {
		// A direct (project-less) shared expense: bob owes alice $25.
		seedBobOwesAlice(null, 25);

		const bobSettle = new SettlementService(db as never, BOB);
		const { settlement } = await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 25,
			currency: "USD",
			// no projectId => global cap, project-less row
		});
		expect(db._stores.settlements.get(settlement.id)?.projectId).toBeNull();
	});

	it("global entry allocates the payment across projects and the direct bucket", async () => {
		// bob owes alice $40 in A, $10 in B and $5 directly: $55 globally.
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice("B", 10);
		seedBobOwesAlice(null, 5);

		const bobSettle = new SettlementService(db as never, BOB);
		const result = await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 55,
			currency: "USD",
		});

		// One row per scope, each capped at that scope's debt.
		expect(result.settlements).toHaveLength(3);
		expect(settlementRows()).toEqual([
			{ projectId: null, amount: 5 },
			{ projectId: "B", amount: 10 },
			{ projectId: "A", amount: 40 },
		]);

		// Every view agrees: each project and the global rollup are settled.
		for (const projectScope of ["A", "B", null]) {
			const scoped = await computeBalance(db as never, aliceRef, bobRef, {
				projectScope,
			});
			expect(scoped.byCurrency).toEqual({});
		}
		const global = await computeBalance(db as never, aliceRef, bobRef);
		expect(global.byCurrency).toEqual({});
	});

	it("partial global payment clears the smallest debts first and never over-pays a scope", async () => {
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice("B", 10);
		seedBobOwesAlice(null, 5);

		const bobSettle = new SettlementService(db as never, BOB);
		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 12,
			currency: "USD",
		});

		expect(settlementRows()).toEqual([
			{ projectId: null, amount: 5 },
			{ projectId: "B", amount: 7 },
		]);
		const byProject = await computeBalanceByProject(
			db as never,
			aliceRef,
			bobRef,
		);
		expect(Object.fromEntries(byProject)).toEqual({
			A: { USD: 40 },
			B: { USD: 3 },
		});
	});

	it("global payment with opposing project balances only pays down scopes that are owed", async () => {
		// bob owes alice $40 in A; alice owes bob $15 in B. Globally bob owes $25.
		seedBobOwesAlice("A", 40);
		seedAliceOwesBob("B", 15);

		const bobSettle = new SettlementService(db as never, BOB);
		// The global cap still applies: $30 > $25 owed globally.
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 30,
				currency: "USD",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);

		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 25,
			currency: "USD",
		});

		// Only project A (where bob owes) receives the payment. B keeps its own
		// genuine debt in the other direction, and the rollup is settled.
		expect(settlementRows()).toEqual([{ projectId: "A", amount: 25 }]);
		const a = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(a.byCurrency).toEqual({ USD: 15 });
		const b = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "B",
		});
		expect(b.byCurrency).toEqual({ USD: -15 });
		const global = await computeBalance(db as never, aliceRef, bobRef);
		expect(global.byCurrency).toEqual({});
	});

	it("global settleAll writes one row per scope", async () => {
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice(null, 5);

		const bobSettle = new SettlementService(db as never, BOB);
		const result = await bobSettle.settleAll({
			toParticipant: aliceRef,
			paymentCurrency: "USD",
		});

		expect(result.totalInPaymentCurrency).toBe(45);
		expect(settlementRows()).toEqual([
			{ projectId: null, amount: 5 },
			{ projectId: "A", amount: 40 },
		]);
		const a = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(a.byCurrency).toEqual({});
	});

	it("direct-only entry (projectId null) settles just the project-less bucket", async () => {
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice(null, 5);

		const bobSettle = new SettlementService(db as never, BOB);
		// The direct bucket only holds $5, so $10 is an over-payment there.
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 10,
				currency: "USD",
				projectId: null,
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);

		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 5,
			currency: "USD",
			projectId: null,
		});
		expect(settlementRows()).toEqual([{ projectId: null, amount: 5 }]);
	});

	it("rejects a projectId the caller has no part in", async () => {
		seedBobOwesAlice("A", 40);
		const bobSettle = new SettlementService(db as never, BOB);

		// Bob has no membership and no expenses in project Z.
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 10,
				currency: "USD",
				projectId: "Z",
			}),
		).rejects.toThrow(/not part of this project/);
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 0.01,
				currency: "USD",
				projectId: "Z",
			}),
		).rejects.toThrow(/not part of this project/);

		// Bob is in project C but has no balance with alice there: even a
		// tolerance-sized amount cannot be stamped onto C.
		addProjectParticipant(db, {
			projectId: "C",
			participantType: "user",
			participantId: BOB,
			role: "EDITOR",
		});
		await expect(
			bobSettle.initiateSettlement({
				toParticipant: aliceRef,
				amount: 0.01,
				currency: "USD",
				projectId: "C",
			}),
		).rejects.toThrow(/no outstanding USD balance/);
		await expect(
			bobSettle.settleAll({
				toParticipant: aliceRef,
				paymentCurrency: "USD",
				projectId: "C",
			}),
		).rejects.toThrow(/No outstanding balance/);
		expect(db._stores.settlements.size).toBe(0);
	});

	it("a member removed from the project can still settle their balance there", async () => {
		seedBobOwesAlice("A", 40);
		// Bob (the payer) was removed from project A: his membership row is gone
		// but his expenses and balance there remain.
		for (const [id, pp] of db._stores.projectParticipants) {
			if (pp.projectId === "A" && pp.participantId === BOB) {
				db._stores.projectParticipants.delete(id);
			}
		}

		const bobSettle = new SettlementService(db as never, BOB);
		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 15,
			currency: "USD",
			projectId: "A",
		});
		await bobSettle.settleAll({
			toParticipant: aliceRef,
			paymentCurrency: "USD",
			projectId: "A",
		});

		expect(settlementRows()).toEqual([
			{ projectId: "A", amount: 15 },
			{ projectId: "A", amount: 25 },
		]);
		const a = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(a.byCurrency).toEqual({});
	});

	it("can settle with a counterparty who was removed from the project", async () => {
		seedBobOwesAlice("A", 40);
		for (const [id, pp] of db._stores.projectParticipants) {
			if (pp.projectId === "A" && pp.participantId === ALICE) {
				db._stores.projectParticipants.delete(id);
			}
		}

		const bobSettle = new SettlementService(db as never, BOB);
		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 40,
			currency: "USD",
			projectId: "A",
		});
		expect(settlementRows()).toEqual([{ projectId: "A", amount: 40 }]);
	});

	it("records at most the scoped debt when the amount is within the tolerance", async () => {
		seedBobOwesAlice("A", 40);
		const bobSettle = new SettlementService(db as never, BOB);
		await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 40.01,
			currency: "USD",
			projectId: "A",
		});
		expect(settlementRows()).toEqual([{ projectId: "A", amount: 40 }]);
	});

	it("project views count a global settle-up against a legacy claimed shadow's debt", async () => {
		// Before 2026-08-01 the signup auto-claim only stamped claimedById: bob's
		// pre-claim debt in project A still names his shadow.
		db._stores.shadowProfiles.set("shadow-bob", {
			id: "shadow-bob",
			name: "Bobby",
			email: null,
			phone: null,
			createdById: ALICE,
			claimedById: BOB,
		});
		seedBobOwesAlice("A", 30);
		for (const [id, sp] of db._stores.splits) {
			if (sp.participantId === BOB && Number(sp.shareAmount) === 30) {
				db._stores.splits.set(id, {
					...sp,
					participantType: "shadow",
					participantId: "shadow-bob",
				});
			}
		}
		// A direct expense with both raw refs so the settle-up relationship holds.
		seedBobOwesAlice(null, 0);

		// Bob pays globally; the alias-aware allocation puts it in project A
		// under his USER ref.
		const bobSettle = new SettlementService(db as never, BOB);
		const { settlement } = await bobSettle.initiateSettlement({
			toParticipant: aliceRef,
			amount: 30,
			currency: "USD",
		});
		await new SettlementService(db as never, ALICE).confirmSettlement(
			settlement.id,
		);
		expect(settlementRows()).toEqual([{ projectId: "A", amount: 30 }]);

		// The project's ledger as the project views read it.
		const txs = [...db._stores.transactions.values()]
			.filter((tx) => tx.projectId === "A")
			.map((tx) => ({
				currency: tx.currency,
				amount: tx.amount,
				paidByType: tx.paidByType as "user",
				paidById: tx.paidById,
				splitParticipants: [...db._stores.splits.values()]
					.filter((sp) => sp.transactionId === tx.id)
					.map((sp) => ({
						participantType: sp.participantType as "user" | "shadow",
						participantId: sp.participantId,
						shareAmount: sp.shareAmount,
					})),
			}));
		const settlements = [...db._stores.settlements.values()]
			.filter((st) => st.projectId === "A" && st.status === "FINALIZED")
			.map((st) => ({
				fromParticipantType: st.fromParticipantType as "user",
				fromParticipantId: st.fromParticipantId,
				toParticipantType: st.toParticipantType as "user",
				toParticipantId: st.toParticipantId,
				amount: st.amount,
				currency: st.currency,
			}));

		const nets = (plan: ReturnType<typeof computeSettlementPlan>) =>
			Object.fromEntries(
				(plan.byCurrency.USD?.balances ?? []).map((b) => [
					`${b.participant.participantType}:${b.participant.participantId}`,
					b.netBalance,
				]),
			);

		// Raw refs: the debt sits on the shadow and the payment on the user, so
		// the shadow still shows as owing (and the balances no longer add up).
		expect(nets(computeSettlementPlan(txs, settlements))).toEqual({
			"user:alice": 0,
			"shadow:shadow-bob": -30,
		});

		// Canonicalized: one person, settled.
		const ledger = await canonicalizeProjectLedger(
			db as never,
			"A",
			txs,
			settlements,
		);
		const canonical = computeSettlementPlan(
			ledger.transactions,
			ledger.settlements,
		);
		expect(isFullySettled(canonical)).toBe(true);
		expect(nets(canonical)).toEqual({ "user:alice": 0, "user:bob": 0 });
		// Bob is represented by his project membership ref (user:bob).
		expect(
			ledger.transactions.flatMap((tx) =>
				tx.splitParticipants.map((sp) => `${sp.participantType}:${sp.participantId}`),
			),
		).toEqual(["user:bob", "user:alice"]);
	});

	it("voidAutoFinalizedSettlement works on a scoped settlement to a non-user payee", async () => {
		// bob owes a shadow $30 in project A (shadow paid). We settle bob -> shadow
		// scoped to A; a shadow payee auto-finalizes; voiding restores the balance.
		const shadow = db._stores.shadowProfiles;
		shadow.set("shadow-x", {
			id: "shadow-x",
			name: "Marcus",
			email: null,
			phone: null,
			createdById: BOB,
			claimedById: null,
		});
		const shadowRef = makeShadowRef("shadow-x");

		// Shadow paid $30 in project A; bob owes $30.
		const txId = "tx-shadow";
		db._stores.transactions.set(txId, {
			id: txId,
			description: "Shadow expense",
			amount: 30,
			currency: "USD",
			date: new Date("2026-03-01"),
			paidByType: "shadow",
			paidById: "shadow-x",
			createdByType: "user",
			createdById: BOB,
			splitMode: "EXACT",
			projectId: "A",
			billingPeriodId: null,
			isLocked: false,
			notes: null,
			receiptUrl: null,
			categoryId: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		db._stores.splits.set("sp-shadow-bob", {
			id: "sp-shadow-bob",
			transactionId: txId,
			participantType: "user",
			participantId: BOB,
			shareAmount: 30,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "ACCEPTED",
			verifiedAt: new Date(),
			rejectionReason: null,
			hasUnseenChanges: false,
		});
		// Shadow is also a split participant (own share 0) so the bob<->shadow
		// relationship check passes without changing the pairwise balance.
		db._stores.splits.set("sp-shadow-self", {
			id: "sp-shadow-self",
			transactionId: txId,
			participantType: "shadow",
			participantId: "shadow-x",
			shareAmount: 0,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "ACCEPTED",
			verifiedAt: new Date(),
			rejectionReason: null,
			hasUnseenChanges: false,
		});

		const bobSettle = new SettlementService(db as never, BOB);
		const { settlement, requiresPayeeConfirmation } =
			await bobSettle.initiateSettlement({
				toParticipant: shadowRef,
				amount: 30,
				currency: "USD",
				projectId: "A",
			});
		// Shadow payee auto-finalizes (no confirmation needed) and is stamped.
		expect(requiresPayeeConfirmation).toBe(false);
		const row = db._stores.settlements.get(settlement.id)!;
		expect(row.projectId).toBe("A");
		expect(row.status).toBe("FINALIZED");

		// Scoped balance now settled.
		const before = await computeBalance(db as never, bobRef, shadowRef, {
			projectScope: "A",
		});
		expect(before.byCurrency.USD ?? 0).toBe(0);

		// Void restores the scoped balance (bob owes shadow $30 again).
		await bobSettle.voidAutoFinalizedSettlement(settlement.id);
		expect(db._stores.settlements.size).toBe(0);
		const after = await computeBalance(db as never, bobRef, shadowRef, {
			projectScope: "A",
		});
		expect(after.byCurrency).toEqual({ USD: -30 });
	});

	it("alice records a payment received from bob in the People view: every scope clears", async () => {
		// bob owes alice $40 in project A and $10 in direct expenses.
		seedBobOwesAlice("A", 40);
		seedBobOwesAlice(null, 10);

		const aliceSettle = new SettlementService(db as never, ALICE);
		const result = await aliceSettle.initiateSettlement({
			toParticipant: bobRef,
			direction: "incoming",
			amount: 50,
			currency: "USD",
		});

		// Final at once, bob is the payer.
		expect(result.requiresPayeeConfirmation).toBe(false);
		for (const s of db._stores.settlements.values()) {
			expect(s.fromParticipantId).toBe(BOB);
			expect(s.toParticipantId).toBe(ALICE);
			expect(s.status).toBe("FINALIZED");
		}
		expect(settlementRows()).toEqual(
			expect.arrayContaining([
				{ projectId: "A", amount: 40 },
				{ projectId: null, amount: 10 },
			]),
		);

		const global = await computeBalance(db as never, aliceRef, bobRef);
		expect(global.byCurrency.USD ?? 0).toBe(0);
		const inA = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(inA.byCurrency.USD ?? 0).toBe(0);
	});

	it("alice cannot record more than bob owes her", async () => {
		seedBobOwesAlice("A", 40);

		const aliceSettle = new SettlementService(db as never, ALICE);
		await expect(
			aliceSettle.initiateSettlement({
				toParticipant: bobRef,
				direction: "incoming",
				amount: 45,
				currency: "USD",
				projectId: "A",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);
		expect(db._stores.settlements.size).toBe(0);
	});

	it("alice can undo a payment she recorded as received", async () => {
		seedBobOwesAlice("A", 40);

		const aliceSettle = new SettlementService(db as never, ALICE);
		const { settlement } = await aliceSettle.initiateSettlement({
			toParticipant: bobRef,
			direction: "incoming",
			amount: 40,
			currency: "USD",
			projectId: "A",
		});
		await aliceSettle.voidAutoFinalizedSettlement(settlement.id);

		const inA = await computeBalance(db as never, aliceRef, bobRef, {
			projectScope: "A",
		});
		expect(inA.byCurrency).toEqual({ USD: 40 });
	});
});

// ── Suite 1J: Auto-accept window restarts on edit ─────────────────────────────

describe("Suite 1J: Auto-accept expiry counts from the last re-verification", () => {
	const DAY = 24 * 60 * 60 * 1000;
	let db: ReturnType<typeof createStatefulDb>;

	beforeEach(() => {
		db = createStatefulDb();
	});

	function seedPendingSplit(dates: {
		txCreated: Date;
		txUpdated: Date;
		splitCreated: Date;
	}) {
		db._stores.transactions.set("tx-old", {
			id: "tx-old",
			description: "Old dinner",
			amount: 100,
			currency: "USD",
			date: dates.txCreated,
			paidByType: "user",
			paidById: ALICE,
			createdByType: "user",
			createdById: ALICE,
			splitMode: "EQUAL",
			projectId: null,
			billingPeriodId: null,
			isLocked: false,
			notes: null,
			receiptUrl: null,
			categoryId: null,
			createdAt: dates.txCreated,
			updatedAt: dates.txUpdated,
		});
		db._stores.splits.set("sp-bob", {
			id: "sp-bob",
			transactionId: "tx-old",
			participantType: "user",
			participantId: BOB,
			shareAmount: 50,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "PENDING",
			verifiedAt: null,
			rejectionReason: null,
			hasUnseenChanges: true,
			createdAt: dates.splitCreated,
		});
	}

	it("auto-accepts a split that has been pending for more than 7 days", async () => {
		const old = new Date(Date.now() - 30 * DAY);
		seedPendingSplit({ txCreated: old, txUpdated: old, splitCreated: old });

		const accepted = await new VerificationService(
			db as never,
			bobRef,
		).findAndAutoAcceptExpired();

		expect(accepted).toBe(1);
		expect(db._stores.splits.get("sp-bob")?.verificationStatus).toBe(
			"AUTO_ACCEPTED",
		);
	});

	it("keeps an old expense edited yesterday pending (reset in place)", async () => {
		const old = new Date(Date.now() - 30 * DAY);
		seedPendingSplit({
			txCreated: old,
			txUpdated: new Date(Date.now() - DAY),
			splitCreated: old,
		});

		const accepted = await new VerificationService(
			db as never,
			bobRef,
		).findAndAutoAcceptExpired();

		expect(accepted).toBe(0);
		expect(db._stores.splits.get("sp-bob")?.verificationStatus).toBe("PENDING");
	});

	it("keeps a split recreated yesterday pending (split rows replaced)", async () => {
		const old = new Date(Date.now() - 30 * DAY);
		seedPendingSplit({
			txCreated: old,
			txUpdated: old,
			splitCreated: new Date(Date.now() - DAY),
		});

		const accepted = await new VerificationService(
			db as never,
			bobRef,
		).findAndAutoAcceptExpired();

		expect(accepted).toBe(0);
		expect(db._stores.splits.get("sp-bob")?.verificationStatus).toBe("PENDING");
	});
});

// ── Suite 1K: Delete / "Remove me" after the share was already paid ───────────

describe("Suite 1K: Removing a paid share asks before creating a reverse debt", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let txnId: string;

	beforeEach(async () => {
		db = createStatefulDb();
		// alice pays $100, split with bob: bob owes alice $50.
		const { transaction } = await new SharedTransactionService(
			db as never,
			aliceRef,
		).create(makeCreateInput());
		txnId = transaction.id;
	});

	async function bobPaysAlice(amount: number) {
		await new SettlementService(db as never, BOB).initiateSettlement({
			toParticipant: aliceRef,
			amount,
			currency: "USD",
		});
	}

	it("bob can remove himself without confirmation while he still owes his share", async () => {
		await new VerificationService(db as never, bobRef).removeSelf(txnId);

		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency.USD ?? 0).toBe(0);
	});

	it("bob must confirm removing himself after he already paid alice", async () => {
		await bobPaysAlice(50);
		const verify = new VerificationService(db as never, bobRef);

		await expect(verify.removeSelf(txnId)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		// Nothing removed yet.
		expect(
			[...db._stores.splits.values()].some((sp) => sp.participantId === BOB),
		).toBe(true);

		await verify.removeSelf(txnId, true);
		// Confirmed: his $50 payment is now owed back to him.
		const balance = await computeBalance(db as never, aliceRef, bobRef);
		expect(balance.byCurrency).toEqual({ USD: -50 });
	});

	it("alice must confirm deleting the expense after bob already paid her", async () => {
		await bobPaysAlice(50);
		const txService = new SharedTransactionService(db as never, aliceRef);

		await expect(txService.delete(txnId)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(db._stores.transactions.has(txnId)).toBe(true);

		await txService.delete(txnId, true);
		expect(db._stores.transactions.has(txnId)).toBe(false);
	});
});
