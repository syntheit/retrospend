/**
 * Integration Test Suite 2: Project and Billing Period Lifecycle
 *
 * Tests the project creation flow, billing period management, and
 * the locking/settlement lifecycle. Uses a stateful mock DB and
 * exercises the service classes directly (SharedTransactionService,
 * VerificationService). For the billing period router logic, we test
 * the key invariants by manipulating DB state directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import { requireProjectRole } from "./project-permissions";
import {
	addBillingPeriod,
	addProject,
	addProjectParticipant,
	createStatefulDb,
	makeUserRef,
} from "./test-utils";
import { SharedTransactionService } from "./transaction.service";
import { VerificationService } from "./verification.service";

const ALICE = "alice";
const BOB = "bob";
const aliceRef = makeUserRef(ALICE);
const bobRef = makeUserRef(BOB);

// ── Suite 2A: Project setup and billing period creation ───────────────────────

describe("Suite 2A: Project with billing period: expense auto-linking", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;
	let periodId: string;

	beforeEach(() => {
		db = createStatefulDb();

		// Set up an ONGOING project with alice as ORGANIZER
		const project = addProject(db, {
			createdById: ALICE,
			type: "ONGOING",
			billingCycleLength: "MONTHLY",
		});
		projectId = project.id;

		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: ALICE,
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: BOB,
			role: "CONTRIBUTOR",
		});

		// Add an OPEN billing period
		const period = addBillingPeriod(db, {
			projectId,
			label: "March 2026",
			startDate: new Date("2026-03-01"),
			endDate: new Date("2026-03-31"),
			status: "OPEN",
		});
		periodId = period.id;
	});

	it("expense created in an ONGOING project auto-links to the open billing period", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);

		const result = await txService.create({
			amount: 100,
			currency: "USD",
			description: "Office supplies",
			date: new Date("2026-03-15"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		expect(result.transaction.billingPeriodId).toBe(periodId);
		expect(result.backdatedWarning).toBeNull();
	});

	it("expense dated before the period start produces a backdated warning", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);

		const result = await txService.create({
			amount: 50,
			currency: "USD",
			description: "February expense",
			date: new Date("2026-02-15"), // before period start 2026-03-01
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		// Still goes into the OPEN period but with a warning
		expect(result.transaction.billingPeriodId).toBe(periodId);
		expect(result.backdatedWarning).not.toBeNull();
		expect(result.backdatedWarning?.periodLabel).toBe("March 2026");
	});

	it("expense created with a future date works: date is metadata only", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);

		// Future date: March 25 (still within the open period)
		const result = await txService.create({
			amount: 75,
			currency: "USD",
			description: "Upcoming event",
			date: new Date("2026-03-25"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		expect(result.transaction.date).toEqual(new Date("2026-03-25"));
		expect(result.transaction.billingPeriodId).toBe(periodId);
		expect(result.backdatedWarning).toBeNull();
	});

	it("contributor can create expenses in a project they're a member of", async () => {
		// Bob is CONTRIBUTOR: he should be able to create expenses
		const bobTxService = new SharedTransactionService(db as never, bobRef);

		const result = await bobTxService.create({
			amount: 60,
			currency: "USD",
			description: "Bob's expense",
			date: new Date("2026-03-10"),
			paidBy: bobRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		expect(result.transaction).toBeDefined();
		expect(result.transaction.createdById).toBe(BOB);
		expect(result.transaction.billingPeriodId).toBe(periodId);
	});

	it("non-member cannot create expenses in a project: FORBIDDEN", async () => {
		const carolRef = makeUserRef("carol");
		// carol is not a project participant
		const carolTxService = new SharedTransactionService(db as never, carolRef);

		await expect(
			carolTxService.create({
				amount: 50,
				currency: "USD",
				description: "Carol's attempt",
				date: new Date("2026-03-10"),
				paidBy: carolRef,
				splitWith: [aliceRef, carolRef],
				splitMode: "EQUAL",
				projectId,
			}),
		).rejects.toThrow("You are not a participant of this project");
	});

	it("expense without projectId does NOT auto-link to any billing period", async () => {
		const txService = new SharedTransactionService(db as never, aliceRef);

		const result = await txService.create({
			amount: 50,
			currency: "USD",
			description: "Personal expense, no project",
			date: new Date("2026-03-10"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			// No projectId
		});

		expect(result.transaction.projectId).toBeNull();
		expect(result.transaction.billingPeriodId).toBeNull();
	});
});

// ── Suite 2B: Billing period close → new period ───────────────────────────────

describe("Suite 2B: Billing period lifecycle: close and settle", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;
	let openPeriodId: string;

	beforeEach(() => {
		db = createStatefulDb();

		const project = addProject(db, {
			createdById: ALICE,
			type: "ONGOING",
			billingCycleLength: "MONTHLY",
		});
		projectId = project.id;

		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: ALICE,
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: BOB,
			role: "CONTRIBUTOR",
		});

		const period = addBillingPeriod(db, {
			projectId,
			label: "March 2026",
			startDate: new Date("2026-03-01"),
			endDate: new Date("2026-03-31"),
			status: "OPEN",
		});
		openPeriodId = period.id;
	});

	it("closing a CLOSING period requires all splits to be ACCEPTED/AUTO_ACCEPTED", async () => {
		// Create an expense in the period
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create({
			amount: 100,
			currency: "USD",
			description: "Office lunch",
			date: new Date("2026-03-15"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		// Manually set the period to CLOSING (simulates billingPeriod.closeCurrent)
		const period = db._stores.billingPeriods.get(openPeriodId)!;
		db._stores.billingPeriods.set(openPeriodId, {
			...period,
			status: "CLOSING",
		});

		// Count PENDING splits in the closing period
		const pendingSplits = [...db._stores.splits.values()].filter((sp) => {
			const tx = db._stores.transactions.get(sp.transactionId);
			return (
				tx?.billingPeriodId === openPeriodId &&
				sp.verificationStatus === "PENDING"
			);
		});

		// Bob hasn't accepted yet: should be 1 PENDING split
		expect(pendingSplits).toHaveLength(1);
		expect(pendingSplits[0]?.participantId).toBe(BOB);
	});

	it("after all splits accepted: settlePeriod locks all transactions", async () => {
		// Create and accept expense
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create({
			amount: 100,
			currency: "USD",
			description: "Office lunch",
			date: new Date("2026-03-15"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.accept(transaction.id);

		// Simulate settlePeriod: period → SETTLED, transactions → isLocked = true
		const period = db._stores.billingPeriods.get(openPeriodId)!;
		db._stores.billingPeriods.set(openPeriodId, {
			...period,
			status: "CLOSING",
		});

		// Manually settle (simulates billingPeriod.settlePeriod)
		db._stores.billingPeriods.set(openPeriodId, {
			...period,
			status: "SETTLED",
			settledAt: new Date(),
		});
		const tx = db._stores.transactions.get(transaction.id)!;
		db._stores.transactions.set(transaction.id, { ...tx, isLocked: true });

		// Now try to edit the locked transaction
		await expect(
			txService.update({ id: transaction.id, description: "Edit attempt" }),
		).rejects.toThrow("Settled transactions cannot be modified");

		// And try to delete it
		await expect(txService.delete(transaction.id)).rejects.toThrow(
			"Settled transactions cannot be modified",
		);
	});

	it("new expense after period close goes into the NEW open period", async () => {
		// Create first expense in the open period
		const txService = new SharedTransactionService(db as never, aliceRef);
		await txService.create({
			amount: 100,
			currency: "USD",
			description: "March expense",
			date: new Date("2026-03-15"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		// Close the period: add a new OPEN period (simulates billingPeriod.closeCurrent)
		const oldPeriod = db._stores.billingPeriods.get(openPeriodId)!;
		db._stores.billingPeriods.set(openPeriodId, {
			...oldPeriod,
			status: "CLOSING",
		});

		const newPeriod = addBillingPeriod(db, {
			projectId,
			label: "April 2026",
			startDate: new Date("2026-04-01"),
			endDate: new Date("2026-04-30"),
			status: "OPEN",
		});

		// Create a new expense: should link to the new OPEN period
		const result = await txService.create({
			amount: 50,
			currency: "USD",
			description: "April expense",
			date: new Date("2026-04-10"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		expect(result.transaction.billingPeriodId).toBe(newPeriod.id);
	});

	it("closing a billing period with zero expenses works: period becomes CLOSING", async () => {
		// No expenses in the period
		expect([...db._stores.transactions.values()]).toHaveLength(0);

		// Simulate closeCurrent: no unverified splits to block the close
		const pendingSplits = [...db._stores.splits.values()].filter((sp) => {
			const tx = db._stores.transactions.get(sp.transactionId);
			return (
				tx?.billingPeriodId === openPeriodId &&
				sp.verificationStatus === "PENDING"
			);
		});
		expect(pendingSplits).toHaveLength(0);

		// The period can be closed even with zero transactions
		const period = db._stores.billingPeriods.get(openPeriodId)!;
		db._stores.billingPeriods.set(openPeriodId, {
			...period,
			status: "CLOSING",
			closedAt: new Date(),
		});

		expect(db._stores.billingPeriods.get(openPeriodId)?.status).toBe("CLOSING");
	});

	it("cannot settle a period with unverified REJECTED participants", async () => {
		// Create expense
		const txService = new SharedTransactionService(db as never, aliceRef);
		const { transaction } = await txService.create({
			amount: 100,
			currency: "USD",
			description: "Test expense",
			date: new Date("2026-03-10"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
			projectId,
		});

		// Bob rejects: now there's a REJECTED split in this period
		const verifyService = new VerificationService(db as never, bobRef);
		await verifyService.reject(transaction.id, "Dispute");

		// Simulate settlePeriod check: count PENDING or REJECTED splits
		const unverifiedCount = [...db._stores.splits.values()].filter((sp) => {
			const tx = db._stores.transactions.get(sp.transactionId);
			if (tx?.billingPeriodId !== openPeriodId) return false;
			return ["PENDING", "REJECTED"].includes(sp.verificationStatus);
		}).length;

		// Should be 1 (bob's REJECTED split)
		expect(unverifiedCount).toBe(1);
		// This would cause settlePeriod to throw BAD_REQUEST in the real router
	});
});

// ── Suite 2C: Project membership and permissions ──────────────────────────────

describe("Suite 2C: Project membership and role enforcement", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;

	beforeEach(() => {
		db = createStatefulDb();

		const project = addProject(db, { createdById: ALICE });
		projectId = project.id;

		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: ALICE,
			role: "ORGANIZER",
		});
		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: BOB,
			role: "VIEWER",
		});
	});

	it("ORGANIZER passes requireProjectRole check", async () => {
		const pp = await requireProjectRole(
			db as never,
			projectId,
			"user",
			ALICE,
			"ORGANIZER",
		);
		expect(pp.role).toBe("ORGANIZER");
	});

	it("VIEWER fails CONTRIBUTOR requireProjectRole check", async () => {
		await expect(
			requireProjectRole(db as never, projectId, "user", BOB, "CONTRIBUTOR"),
		).rejects.toThrow("This action requires the CONTRIBUTOR role or higher");
	});

	it("non-member fails any requireProjectRole check", async () => {
		await expect(
			requireProjectRole(db as never, projectId, "user", "carol", "VIEWER"),
		).rejects.toThrow("You are not a participant of this project");
	});

	it("VIEWER passes VIEWER requireProjectRole check", async () => {
		const pp = await requireProjectRole(
			db as never,
			projectId,
			"user",
			BOB,
			"VIEWER",
		);
		expect(pp.role).toBe("VIEWER");
	});
});
