/**
 * Integration Test Suite 5: Permission Matrix & hasUnseenChanges Tracking
 *
 * Tests the complete permission matrix for update/delete operations and
 * verifies that hasUnseenChanges is set correctly after edits.
 *
 * Covers:
 *   - Project roles: ORGANIZER, EDITOR, CONTRIBUTOR, VIEWER
 *   - Guest roles: CONTRIBUTOR, VIEWER
 *   - Standalone transactions (no project)
 *   - Locked (settled) transactions
 *   - hasUnseenChanges flag tracking after edits
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import {
	addProject,
	addProjectParticipant,
	createStatefulDb,
	makeGuestRef,
	makeUserRef,
	type SplitRecord,
} from "./test-utils";
import { SharedTransactionService } from "./transaction.service";

// ── Participant constants ──────────────────────────────────────────────────────

const ALICE = "alice";
const BOB = "bob";
const CAROL = "carol";
const DAVE = "dave";

const aliceRef = makeUserRef(ALICE);
const bobRef = makeUserRef(BOB);
const carolRef = makeUserRef(CAROL);
const daveRef = makeUserRef(DAVE);

type Db = ReturnType<typeof createStatefulDb>;
type ParticipantRef = { participantType: "user" | "guest" | "shadow"; participantId: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set up a project with the given participants and return its record. */
function setupProject(
	db: Db,
	participants: { ref: ParticipantRef; role: string }[],
) {
	const project = addProject(db, { createdById: ALICE });
	for (const { ref, role } of participants) {
		addProjectParticipant(db, {
			projectId: project.id,
			participantType: ref.participantType,
			participantId: ref.participantId,
			role,
		});
	}
	return project;
}

/** Create an expense inside a project via the given actor. */
async function createProjectExpense(
	db: Db,
	actor: ParticipantRef,
	projectId: string,
	opts: {
		paidBy?: ParticipantRef;
		splitWith?: ParticipantRef[];
	} = {},
) {
	const svc = new SharedTransactionService(db as never, actor);
	const result = await svc.create({
		amount: 100,
		currency: "USD",
		description: "Test expense",
		date: new Date("2026-03-01"),
		paidBy: opts.paidBy ?? actor,
		splitWith: opts.splitWith ?? [aliceRef, bobRef],
		splitMode: "EQUAL",
		projectId,
	});
	return result.transaction;
}

/** Create a standalone (no project) expense via the given actor. */
async function createStandaloneExpense(db: Db, actor: ParticipantRef) {
	const svc = new SharedTransactionService(db as never, actor);
	const result = await svc.create({
		amount: 50,
		currency: "USD",
		description: "Standalone expense",
		date: new Date("2026-03-01"),
		paidBy: actor,
		splitWith: [aliceRef, bobRef],
		splitMode: "EQUAL",
	});
	return result.transaction;
}

/** Get the split records for a transaction from the mock store. */
function getSplits(db: Db, txId: string): SplitRecord[] {
	return [...db._stores.splits.values()].filter(
		(sp) => sp.transactionId === txId,
	);
}

// ── Suite 5A: update permission matrix ───────────────────────────────────────

describe("Suite 5A: update - project role permission matrix", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("ORGANIZER can edit any expense, including one created by someone else", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Bob (CONTRIBUTOR) creates the expense
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		// Alice (ORGANIZER) edits Bob's expense → should succeed
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "Updated by organizer" }),
		).resolves.toBeDefined();
	});

	it("EDITOR can edit any expense, including one created by someone else", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "EDITOR" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "Updated by editor" }),
		).resolves.toBeDefined();
	});

	it("CONTRIBUTOR can edit their own expense", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Bob creates and then edits his own expense
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(
			svc.update({ id: tx.id, description: "Bob updated his own" }),
		).resolves.toBeDefined();
	});

	it("CONTRIBUTOR cannot edit someone else's expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Alice (ORGANIZER) creates the expense
		const tx = await createProjectExpense(db, aliceRef, project.id);
		// Bob (CONTRIBUTOR) tries to edit Alice's expense
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(
			svc.update({ id: tx.id, description: "Bob unauthorized" }),
		).rejects.toThrow("You can only edit expenses you created");
	});

	it("VIEWER cannot edit any expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
			{ ref: carolRef, role: "VIEWER" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const svc = new SharedTransactionService(db as never, carolRef);
		await expect(
			svc.update({ id: tx.id, description: "Carol viewer" }),
		).rejects.toThrow("Viewers cannot edit or delete expenses");
	});

	it("non-participant cannot edit a project expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		// Dave is not a project participant
		const svc = new SharedTransactionService(db as never, daveRef);
		await expect(
			svc.update({ id: tx.id, description: "Dave intruder" }),
		).rejects.toThrow("You are not a participant of this project");
	});

	it("locked (settled) transaction cannot be edited regardless of role → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		// Lock the transaction (simulates billing period settlement)
		db._stores.transactions.set(tx.id, {
			...db._stores.transactions.get(tx.id)!,
			isLocked: true,
		});
		// Even ORGANIZER cannot edit a locked transaction
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "Edit locked" }),
		).rejects.toThrow("Settled transactions cannot be modified");
	});

	it("creator can edit a standalone expense", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "Alice edits own" }),
		).resolves.toBeDefined();
	});

	it("non-creator cannot edit a standalone expense → FORBIDDEN", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(
			svc.update({ id: tx.id, description: "Bob unauthorized standalone" }),
		).rejects.toThrow("Only the creator can edit this expense");
	});

	it("guest CONTRIBUTOR can edit their own expense", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "CONTRIBUTOR" },
		]);
		// Guest creates their own expense
		const svc = new SharedTransactionService(db as never, guestRef);
		const result = await svc.create({
			amount: 60,
			currency: "USD",
			description: "Guest expense",
			date: new Date("2026-03-01"),
			paidBy: guestRef,
			splitWith: [aliceRef, guestRef],
			splitMode: "EQUAL",
			projectId: project.id,
		});
		// Guest edits their own expense → should succeed
		await expect(
			svc.update({
				id: result.transaction.id,
				description: "Guest updated own",
			}),
		).resolves.toBeDefined();
	});

	it("guest CONTRIBUTOR cannot edit someone else's expense → FORBIDDEN", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "CONTRIBUTOR" },
		]);
		// Alice creates an expense that includes the guest
		const aliceSvc = new SharedTransactionService(db as never, aliceRef);
		const result = await aliceSvc.create({
			amount: 100,
			currency: "USD",
			description: "Alice expense",
			date: new Date("2026-03-01"),
			paidBy: aliceRef,
			splitWith: [aliceRef, guestRef],
			splitMode: "EQUAL",
			projectId: project.id,
		});
		// Guest tries to edit Alice's expense → FORBIDDEN
		const guestSvc = new SharedTransactionService(db as never, guestRef);
		await expect(
			guestSvc.update({
				id: result.transaction.id,
				description: "Guest edited others",
			}),
		).rejects.toThrow("You can only edit expenses you created");
	});

	it("guest VIEWER cannot edit any expense → FORBIDDEN", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "VIEWER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const guestSvc = new SharedTransactionService(db as never, guestRef);
		await expect(
			guestSvc.update({ id: tx.id, description: "Guest viewer edit" }),
		).rejects.toThrow("Viewers cannot edit or delete expenses");
	});
});

// ── Suite 5B: delete permission matrix ───────────────────────────────────────

describe("Suite 5B: delete - project role permission matrix", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("ORGANIZER can delete any expense, including one created by someone else", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(svc.delete(tx.id)).resolves.toBeUndefined();
		expect(db._stores.transactions.has(tx.id)).toBe(false);
	});

	it("EDITOR can delete any expense", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "EDITOR" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(svc.delete(tx.id)).resolves.toBeUndefined();
		expect(db._stores.transactions.has(tx.id)).toBe(false);
	});

	it("CONTRIBUTOR can delete their own expense", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(svc.delete(tx.id)).resolves.toBeUndefined();
		expect(db._stores.transactions.has(tx.id)).toBe(false);
		// Split records also deleted (cascade)
		expect(getSplits(db, tx.id)).toHaveLength(0);
	});

	it("CONTRIBUTOR cannot delete someone else's expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(svc.delete(tx.id)).rejects.toThrow(
			"You can only edit expenses you created",
		);
	});

	it("VIEWER cannot delete any expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
			{ ref: carolRef, role: "VIEWER" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const svc = new SharedTransactionService(db as never, carolRef);
		await expect(svc.delete(tx.id)).rejects.toThrow(
			"Viewers cannot edit or delete expenses",
		);
	});

	it("non-participant cannot delete a project expense → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const svc = new SharedTransactionService(db as never, daveRef);
		await expect(svc.delete(tx.id)).rejects.toThrow(
			"You are not a participant of this project",
		);
	});

	it("locked (settled) transaction cannot be deleted regardless of role → FORBIDDEN", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		db._stores.transactions.set(tx.id, {
			...db._stores.transactions.get(tx.id)!,
			isLocked: true,
		});
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(svc.delete(tx.id)).rejects.toThrow(
			"Settled transactions cannot be modified",
		);
	});

	it("creator can delete a standalone expense", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(svc.delete(tx.id)).resolves.toBeUndefined();
		expect(db._stores.transactions.has(tx.id)).toBe(false);
	});

	it("non-creator cannot delete a standalone expense → FORBIDDEN", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, bobRef);
		await expect(svc.delete(tx.id)).rejects.toThrow(
			"Only the creator can edit this expense",
		);
	});

	it("guest CONTRIBUTOR can delete their own expense", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "CONTRIBUTOR" },
		]);
		const guestSvc = new SharedTransactionService(db as never, guestRef);
		const result = await guestSvc.create({
			amount: 60,
			currency: "USD",
			description: "Guest expense",
			date: new Date("2026-03-01"),
			paidBy: guestRef,
			splitWith: [aliceRef, guestRef],
			splitMode: "EQUAL",
			projectId: project.id,
		});
		await expect(
			guestSvc.delete(result.transaction.id),
		).resolves.toBeUndefined();
		expect(db._stores.transactions.has(result.transaction.id)).toBe(false);
	});

	it("guest CONTRIBUTOR cannot delete someone else's expense → FORBIDDEN", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "CONTRIBUTOR" },
		]);
		const aliceSvc = new SharedTransactionService(db as never, aliceRef);
		const result = await aliceSvc.create({
			amount: 100,
			currency: "USD",
			description: "Alice expense",
			date: new Date("2026-03-01"),
			paidBy: aliceRef,
			splitWith: [aliceRef, guestRef],
			splitMode: "EQUAL",
			projectId: project.id,
		});
		const guestSvc = new SharedTransactionService(db as never, guestRef);
		await expect(guestSvc.delete(result.transaction.id)).rejects.toThrow(
			"You can only edit expenses you created",
		);
	});

	it("guest VIEWER cannot delete any expense → FORBIDDEN", async () => {
		const guestRef = makeGuestRef("guest-1");
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: guestRef, role: "VIEWER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const guestSvc = new SharedTransactionService(db as never, guestRef);
		await expect(guestSvc.delete(tx.id)).rejects.toThrow(
			"Viewers cannot edit or delete expenses",
		);
	});
});

// ── Suite 5C: hasUnseenChanges tracking ──────────────────────────────────────

describe("Suite 5C: hasUnseenChanges tracking after edit", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("new transaction has hasUnseenChanges=false for all participants", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const splits = getSplits(db, tx.id);
		expect(splits.length).toBeGreaterThan(0);
		for (const sp of splits) {
			expect(sp.hasUnseenChanges).toBe(false);
		}
	});

	it("after editing description: non-editor's split gets hasUnseenChanges=true", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		await svc.update({ id: tx.id, description: "Updated" });

		const splits = getSplits(db, tx.id);
		const aliceSplit = splits.find((sp) => sp.participantId === ALICE);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);

		// Editor's split: NOT flagged
		expect(aliceSplit?.hasUnseenChanges).toBe(false);
		// Non-editor's split: flagged
		expect(bobSplit?.hasUnseenChanges).toBe(true);
	});

	it("after editing amount on EQUAL split: non-editor's new split gets hasUnseenChanges=true", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		// Amount change triggers deleteMany + createMany, then updateMany for hasUnseenChanges
		await svc.update({ id: tx.id, amount: 80 });

		const splits = getSplits(db, tx.id);
		const aliceSplit = splits.find((sp) => sp.participantId === ALICE);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);

		expect(aliceSplit?.hasUnseenChanges).toBe(false);
		expect(bobSplit?.hasUnseenChanges).toBe(true);
		// Amount recalculated: 80/2 = 40 each
		expect(aliceSplit?.shareAmount).toBe(40);
		expect(bobSplit?.shareAmount).toBe(40);
	});

	it("editing twice: hasUnseenChanges stays true for non-editor (boolean, not cumulative)", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		await svc.update({ id: tx.id, description: "First edit" });
		await svc.update({ id: tx.id, description: "Second edit" });

		const splits = getSplits(db, tx.id);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);
		expect(bobSplit?.hasUnseenChanges).toBe(true);
	});

	it("ORGANIZER edits: their own split stays false, all others get true", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		const svc = new SharedTransactionService(db as never, aliceRef);
		await svc.update({ id: tx.id, description: "Organizer edited" });

		const splits = getSplits(db, tx.id);
		const aliceSplit = splits.find((sp) => sp.participantId === ALICE);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);

		// Alice (editor): unchanged
		expect(aliceSplit?.hasUnseenChanges).toBe(false);
		// Bob (non-editor): marked
		expect(bobSplit?.hasUnseenChanges).toBe(true);
	});

	it("CONTRIBUTOR edits their own expense: their split stays false, others get true", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Bob (CONTRIBUTOR) creates the expense; Alice and Bob are in the split
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		const svc = new SharedTransactionService(db as never, bobRef);
		await svc.update({ id: tx.id, description: "Bob edited his own" });

		const splits = getSplits(db, tx.id);
		const aliceSplit = splits.find((sp) => sp.participantId === ALICE);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);

		// Alice (non-editor): marked
		expect(aliceSplit?.hasUnseenChanges).toBe(true);
		// Bob (editor): not marked
		expect(bobSplit?.hasUnseenChanges).toBe(false);
	});

	it("split participant removal: new participant set gets hasUnseenChanges correctly", async () => {
		const carolRef = makeUserRef(CAROL);
		const svc = new SharedTransactionService(db as never, aliceRef);
		// Create a 3-way split
		const result = await svc.create({
			amount: 90,
			currency: "USD",
			description: "Three way",
			date: new Date("2026-03-01"),
			paidBy: aliceRef,
			splitWith: [aliceRef, bobRef, carolRef],
			splitMode: "EQUAL",
		});
		const txId = result.transaction.id;

		// Alice removes Carol (edit with only alice+bob)
		await svc.update({
			id: txId,
			splitWith: [aliceRef, bobRef],
			splitMode: "EQUAL",
		});

		const splits = getSplits(db, txId);
		expect(splits).toHaveLength(2); // carol removed
		const aliceSplit = splits.find((sp) => sp.participantId === ALICE);
		const bobSplit = splits.find((sp) => sp.participantId === BOB);

		// Alice (editor): false
		expect(aliceSplit?.hasUnseenChanges).toBe(false);
		// Bob (non-editor, in new split): true
		expect(bobSplit?.hasUnseenChanges).toBe(true);
	});

	it("no-op edit (same value): hasUnseenChanges is not set (returns early)", async () => {
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);
		// Update with the same description as the original
		await svc.update({ id: tx.id, description: "Standalone expense" });

		// No diff → returns early → no updateMany called → hasUnseenChanges unchanged
		const splits = getSplits(db, tx.id);
		for (const sp of splits) {
			expect(sp.hasUnseenChanges).toBe(false);
		}
	});
});

// ── Suite 5D: canEdit / canDelete flag derivation ─────────────────────────────

describe("Suite 5D: canEdit / canDelete derived from permission logic", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	/**
	 * Verifies that the service allows/denies the action for the given actor.
	 * Returns true if allowed, false if FORBIDDEN.
	 */
	async function canEdit(
		actor: ParticipantRef,
		txId: string,
	): Promise<boolean> {
		const svc = new SharedTransactionService(db as never, actor);
		try {
			await svc.update({ id: txId, description: `canEdit check ${Date.now()}` });
			return true;
		} catch {
			return false;
		}
	}

	async function canDelete(
		actor: ParticipantRef,
		txId: string,
	): Promise<boolean> {
		// We need a fresh transaction for delete (it's destructive), so we skip
		// actually deleting: instead we use assertCanModifyTransaction directly.
		// But since delete is destructive, we test separately via the error path.
		const svc = new SharedTransactionService(db as never, actor);
		try {
			// Use update to probe permission (same guard) without destroying the tx
			await svc.update({ id: txId, description: `canDelete check ${Date.now()}` });
			return true;
		} catch {
			return false;
		}
	}

	it("ORGANIZER: canEdit=true, canDelete=true for all transactions", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Transaction created by Bob (not Alice)
		const tx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		expect(await canEdit(aliceRef, tx.id)).toBe(true);
		expect(await canDelete(aliceRef, tx.id)).toBe(true);
	});

	it("CONTRIBUTOR: canEdit=true, canDelete=true only for their own transactions", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		// Bob's own expense
		const bobTx = await createProjectExpense(db, bobRef, project.id, {
			paidBy: bobRef,
		});
		// Alice's expense
		const aliceTx = await createProjectExpense(db, aliceRef, project.id);

		expect(await canEdit(bobRef, bobTx.id)).toBe(true);
		expect(await canDelete(bobRef, bobTx.id)).toBe(true);
		expect(await canEdit(bobRef, aliceTx.id)).toBe(false);
		expect(await canDelete(bobRef, aliceTx.id)).toBe(false);
	});

	it("VIEWER: canEdit=false, canDelete=false for everything", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
			{ ref: carolRef, role: "VIEWER" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		expect(await canEdit(carolRef, tx.id)).toBe(false);
		expect(await canDelete(carolRef, tx.id)).toBe(false);
	});

	it("locked transaction: canEdit=false, canDelete=false regardless of role", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "CONTRIBUTOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);
		db._stores.transactions.set(tx.id, {
			...db._stores.transactions.get(tx.id)!,
			isLocked: true,
		});
		// ORGANIZER can't edit locked
		expect(await canEdit(aliceRef, tx.id)).toBe(false);
		expect(await canDelete(aliceRef, tx.id)).toBe(false);
	});
});

// ── Suite 5E: Area 7 Edge Cases ───────────────────────────────────────────────

describe("Suite 5E: Area 7 edge cases", () => {
	let db: Db;

	beforeEach(() => {
		db = createStatefulDb();
	});

	it("transaction in a CLOSING billing period (isLocked=false) can still be edited", async () => {
		// A CLOSING billing period means transactions are not yet locked.
		// Only individual isLocked=true blocks editing; period status does not.
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "EDITOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);

		// Simulate a CLOSING billing period by NOT setting isLocked on the transaction.
		// In production, isLocked is only set to true during closeCurrent / settlement.
		// A CLOSING period has status="CLOSING" but transactions have isLocked=false.
		// Confirm the transaction is not locked:
		const stored = db._stores.transactions.get(tx.id)!;
		expect(stored.isLocked).toBe(false);

		// Alice (ORGANIZER) can edit it even if it's "in a CLOSING period":
		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "Edited in closing period" }),
		).resolves.toBeDefined();
	});

	it("locked transaction (isLocked=true) cannot be edited even by ORGANIZER", async () => {
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "EDITOR" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id);

		// Lock the transaction (simulates period closure / settlement)
		db._stores.transactions.set(tx.id, {
			...db._stores.transactions.get(tx.id)!,
			isLocked: true,
		});

		const svc = new SharedTransactionService(db as never, aliceRef);
		await expect(
			svc.update({ id: tx.id, description: "ORGANIZER edit on locked" }),
		).rejects.toThrow("Settled transactions cannot be modified");
	});

	it("after editing, the editor\'s own split stays false; then a no-op edit doesn\'t flip it back", async () => {
		// Edge case: two consecutive edits by the same person
		// First edit: marks Bob's split as hasUnseenChanges=true
		// Second edit (no-op): returns early, doesn't touch hasUnseenChanges
		const tx = await createStandaloneExpense(db, aliceRef);
		const svc = new SharedTransactionService(db as never, aliceRef);

		// Edit 1: real change
		await svc.update({ id: tx.id, description: "First edit" });
		const afterFirst = getSplits(db, tx.id);
		const bobAfterFirst = afterFirst.find((sp) => sp.participantId === BOB);
		expect(bobAfterFirst?.hasUnseenChanges).toBe(true);

		// Edit 2: no-op (same description)
		await svc.update({ id: tx.id, description: "First edit" });
		const afterSecond = getSplits(db, tx.id);
		const bobAfterSecond = afterSecond.find((sp) => sp.participantId === BOB);
		// No-op returns early → hasUnseenChanges unchanged (still true)
		expect(bobAfterSecond?.hasUnseenChanges).toBe(true);
	});

	it("multiple concurrent editors: second edit doesn\'t clear first edit\'s hasUnseenChanges", async () => {
		// Alice edits, then Bob edits. Carol is a viewer.
		// Both edits should mark Carol's split as hasUnseenChanges=true.
		const carolRef2 = makeUserRef(CAROL);
		const project = setupProject(db, [
			{ ref: aliceRef, role: "ORGANIZER" },
			{ ref: bobRef, role: "EDITOR" },
			{ ref: carolRef2, role: "VIEWER" },
		]);
		const tx = await createProjectExpense(db, aliceRef, project.id, {
			splitWith: [aliceRef, bobRef, carolRef2],
		});

		// Alice edits first
		const aliceSvc = new SharedTransactionService(db as never, aliceRef);
		await aliceSvc.update({ id: tx.id, description: "Alice edited" });
		const afterAlice = getSplits(db, tx.id);
		expect(afterAlice.find((sp) => sp.participantId === CAROL)?.hasUnseenChanges).toBe(true);
		expect(afterAlice.find((sp) => sp.participantId === BOB)?.hasUnseenChanges).toBe(true);
		expect(afterAlice.find((sp) => sp.participantId === ALICE)?.hasUnseenChanges).toBe(false);

		// Bob edits second - should keep Carol's flag true, set Alice's flag true.
		// Note: Bob's OWN split stays true from Alice's prior edit - the service only
		// marks non-editors as true; it does NOT reset the editor's own unseen flag.
		// Bob would need to view revision history or call markTransactionSeen to clear it.
		const bobSvc = new SharedTransactionService(db as never, bobRef);
		await bobSvc.update({ id: tx.id, description: "Bob edited" });
		const afterBob = getSplits(db, tx.id);
		expect(afterBob.find((sp) => sp.participantId === CAROL)?.hasUnseenChanges).toBe(true);
		expect(afterBob.find((sp) => sp.participantId === ALICE)?.hasUnseenChanges).toBe(true);
		// Bob's own split remains true from Alice's edit (not reset by Bob's own edit)
		expect(afterBob.find((sp) => sp.participantId === BOB)?.hasUnseenChanges).toBe(true);
	});
});
