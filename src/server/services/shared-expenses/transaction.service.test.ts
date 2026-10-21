import { beforeEach, describe, expect, it, vi } from "vitest";

// Must be mocked before importing SharedTransactionService because the service
// module imports notifications at the top level, which transitively imports
// src/env.js (t3-env), which requires DATABASE_URL/BETTER_AUTH_SECRET to be set.
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

// Mock computeBalance so the delete guard's unsettled-balance check is controlled
// per-test (its own correctness is covered in balance.test.ts).
vi.mock("./balance", () => ({
	computeBalance: vi.fn().mockResolvedValue({ byCurrency: {} }),
}));

import { computeBalance } from "./balance";
import { SharedTransactionService } from "./transaction.service";

// Mock Prisma transaction client
function createMockDb() {
	const txClient = {
		$executeRaw: vi.fn().mockResolvedValue(undefined),
		sharedTransaction: {
			create: vi.fn(),
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		splitParticipant: {
			createMany: vi.fn(),
			deleteMany: vi.fn(),
			updateMany: vi.fn(),
			// The update path reads the current non-actor participants to decide
			// which to auto-accept vs reset. Default to none; tests that exercise
			// the split-unchanged branch set their own rows.
			findMany: vi.fn().mockResolvedValue([]),
		},
		auditLogEntry: {
			create: vi.fn().mockResolvedValue({ id: "audit-1" }),
		},
	};

	const db = {
		$transaction: vi.fn(
			async (cb: (tx: typeof txClient) => Promise<unknown>) => {
				return await cb(txClient);
			},
		),
	};

	return { db, txClient };
}

describe("SharedTransactionService", () => {
	describe("create", () => {
		it("creates a shared transaction with equal split", async () => {
			const { db, txClient } = createMockDb();
			const created = {
				id: "txn-1",
				description: "Dinner",
				amount: 90,
				currency: "USD",
				date: new Date("2026-03-01"),
				splitMode: "EQUAL",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				splitParticipants: [
					{
						id: "sp-1",
						participantType: "user",
						participantId: "alice",
						shareAmount: 30,
						verificationStatus: "ACCEPTED",
					},
					{
						id: "sp-2",
						participantType: "user",
						participantId: "bob",
						shareAmount: 30,
						verificationStatus: "PENDING",
					},
					{
						id: "sp-3",
						participantType: "user",
						participantId: "carol",
						shareAmount: 30,
						verificationStatus: "PENDING",
					},
				],
			};
			txClient.sharedTransaction.create.mockResolvedValue(created);

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			const result = await service.create({
				amount: 90,
				currency: "USD",
				description: "Dinner",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
					{ participantType: "user", participantId: "carol" },
				],
				splitMode: "EQUAL",
			});

			// service.create() returns { transaction, backdatedWarning }
			expect(result.transaction).toBe(created);
			expect(result).toHaveProperty("backdatedWarning");

			// Verify the create call included split participants
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const createCall = firstCall[0];
			const splits = createCall.data.splitParticipants.create;
			expect(splits).toHaveLength(3);
			expect(splits[0].shareAmount).toBe(30);
			expect(splits[1].shareAmount).toBe(30);
			expect(splits[2].shareAmount).toBe(30);

			// Creator's split is ACCEPTED (they authored it). This is a standalone
			// expense (no project), so it auto-accepts: the other participants are
			// AUTO_ACCEPTED, not PENDING. Manual approval only applies to a project
			// that has autoAcceptSplits turned off.
			expect(splits[0].verificationStatus).toBe("ACCEPTED");
			expect(splits[1].verificationStatus).toBe("AUTO_ACCEPTED");
			expect(splits[2].verificationStatus).toBe("AUTO_ACCEPTED");

			// Audit log was created
			expect(txClient.auditLogEntry.create).toHaveBeenCalled();
		});

		it("handles rounding for equal split - extra cent goes to payer", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 100,
				currency: "USD",
				description: "Lunch",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
					{ participantType: "user", participantId: "carol" },
				],
				splitMode: "EQUAL",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const splits = firstCall[0].data.splitParticipants.create;
			// $100 / 3 = $33.33... → payer (alice) gets $33.34, others $33.33
			expect(splits[0].shareAmount).toBe(33.34); // alice (payer)
			expect(splits[1].shareAmount).toBe(33.33); // bob
			expect(splits[2].shareAmount).toBe(33.33); // carol
			expect(
				splits[0].shareAmount + splits[1].shareAmount + splits[2].shareAmount,
			).toBe(100);
		});

		it("allows a payer who is not in the split (fronting a cost)", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			// Alice pays a $50 taxi she is NOT part of: bob and carol split it.
			await service.create({
				amount: 50,
				currency: "USD",
				description: "Taxi",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "bob" },
					{ participantType: "user", participantId: "carol" },
				],
				splitMode: "EQUAL",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const splits = firstCall[0].data.splitParticipants.create;

			// Only the two split participants get a row; the payer (alice) has none,
			// so she owes nothing and is owed the full $50.
			expect(splits).toHaveLength(2);
			expect(
				splits.some(
					(s: { participantId: string }) => s.participantId === "alice",
				),
			).toBe(false);
			const bob = splits.find(
				(s: { participantId: string }) => s.participantId === "bob",
			);
			const carol = splits.find(
				(s: { participantId: string }) => s.participantId === "carol",
			);
			expect(bob.shareAmount).toBe(25);
			expect(carol.shareAmount).toBe(25);
		});

		it("validates exact split amounts sum to total", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Dinner",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{
							participantType: "user",
							participantId: "alice",
							shareAmount: 40,
						},
						{ participantType: "user", participantId: "bob", shareAmount: 40 },
					],
					splitMode: "EXACT",
				}),
			).rejects.toThrow("Split amounts must sum to the transaction amount");
		});

		it("accepts valid exact split", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 100,
				currency: "USD",
				description: "Dinner",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice", shareAmount: 60 },
					{ participantType: "user", participantId: "bob", shareAmount: 40 },
				],
				splitMode: "EXACT",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const splits = firstCall[0].data.splitParticipants.create;
			expect(splits[0].shareAmount).toBe(60);
			expect(splits[1].shareAmount).toBe(40);
		});
	});

	describe("update", () => {
		it("rejects edit by non-creator", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.findUnique.mockResolvedValue({
				id: "txn-1",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "bob",
			});
			await expect(
				service.update({ id: "txn-1", description: "Changed" }),
			).rejects.toThrow("Only the creator can edit");
		});

		it("rejects edit on locked transaction", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.findUnique.mockResolvedValue({
				id: "txn-1",
				createdByType: "user",
				createdById: "alice",
				isLocked: true,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.update({ id: "txn-1", description: "Changed" }),
			).rejects.toThrow("Settled transactions cannot be modified");
		});

		it("description-only edit re-accepts non-actor splits via updateMany (auto-accept expense)", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 50 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EQUAL",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 25 },
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 25 },
					},
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				description: "Dinner at Sotto",
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				description: "Dinner at Sotto",
			});
			// Split-unchanged branch reads the current non-actor participants to
			// classify them; here only bob (a real user) is non-actor.
			txClient.splitParticipant.findMany.mockResolvedValue([
				{ id: "sp-bob", participantType: "user" },
			]);

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				description: "Dinner at Sotto",
			});

			// Splits did not change structurally, so verification is refreshed via
			// updateMany. This is a standalone (auto-accept) expense, so the non-actor
			// participant is re-accepted as AUTO_ACCEPTED, not reset to PENDING.
			// Manual reset to PENDING only happens when the project turns auto-accept
			// off (covered by the integration lifecycle suite).
			expect(txClient.splitParticipant.updateMany).toHaveBeenCalledWith({
				where: { id: { in: ["sp-bob"] } },
				data: {
					verificationStatus: "AUTO_ACCEPTED",
					verifiedAt: expect.any(Date),
					rejectionReason: null,
				},
			});

			// deleteMany should NOT have been called (splits unchanged)
			expect(txClient.splitParticipant.deleteMany).not.toHaveBeenCalled();

			// Audit log records the description change. The audit "changes" payload
			// is the field-level diff keyed by field name (description/amount/...),
			// so it has a "description" key, not "title".
			const firstAuditCall = txClient.auditLogEntry.create.mock.calls[0];
			if (!firstAuditCall) throw new Error("Expected audit log to be created");
			const auditCall = firstAuditCall[0];
			expect(auditCall.data.action).toBe("EDITED");
			expect(auditCall.data.changes).toHaveProperty("description");
			expect(auditCall.data.changes.description).toEqual({
				old: "Dinner",
				new: "Dinner at Sotto",
			});
		});

		it("amount change on EQUAL split recalculates via deleteMany+createMany", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 50 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EQUAL",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 25 },
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 25 },
					},
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: { toNumber: () => 60 },
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: { toNumber: () => 60 },
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				amount: 60,
			});

			// Amount changed on EQUAL split → splits recalculated → deleteMany + createMany
			expect(txClient.splitParticipant.deleteMany).toHaveBeenCalledWith({
				where: { transactionId: "txn-1" },
			});
			expect(txClient.splitParticipant.createMany).toHaveBeenCalled();

			// updateMany called once for hasUnseenChanges (NOT for verification reset, which uses delete+create path)
			expect(txClient.splitParticipant.updateMany).toHaveBeenCalledTimes(1);
			expect(txClient.splitParticipant.updateMany).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { hasUnseenChanges: true },
				}),
			);

			// Audit log has amount diff
			const firstAuditCall = txClient.auditLogEntry.create.mock.calls[0];
			if (!firstAuditCall) throw new Error("Expected audit log to be created");
			const auditCall = firstAuditCall[0];
			expect(auditCall.data.action).toBe("EDITED");
			expect(auditCall.data.changes).toHaveProperty("amount");
			expect(auditCall.data.changes.amount).toEqual({ old: 50, new: 60 });
		});

		it("returns early when nothing changed", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 50 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EQUAL",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			const result = await service.update({
				id: "txn-1",
				description: "Dinner",
			});

			expect(result).toBe(existing);
			expect(txClient.sharedTransaction.update).not.toHaveBeenCalled();
		});
	});

	// ── split mode: EQUAL (edge cases) ─────────────────────────────────────

	describe("computeEqualSplits (via create)", () => {
		async function equalSplit(amount: number, participantIds: string[]) {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const firstParticipantId = participantIds[0];
			if (!firstParticipantId) throw new Error("participantIds cannot be empty");
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: firstParticipantId,
			});
			await service.create({
				amount,
				currency: "USD",
				description: "Test",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: firstParticipantId },
				splitWith: participantIds.map((id) => ({
					participantType: "user" as const,
					participantId: id,
				})),
				splitMode: "EQUAL",
			});
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			return firstCall[0].data.splitParticipants.create as Array<{
				participantId: string;
				shareAmount: number;
			}>;
		}

		it("$100 / 2 people → $50 each", async () => {
			const splits = await equalSplit(100, ["alice", "bob"]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(50);
			expect(split1.shareAmount).toBe(50);
			expect(split0.shareAmount + split1.shareAmount).toBe(100);
		});

		it("$1.00 / 3 people → payer gets $0.34, others get $0.33", async () => {
			const splits = await equalSplit(1.0, ["alice", "bob", "carol"]);
			const split0 = splits[0];
			const split1 = splits[1];
			const split2 = splits[2];
			if (!split0 || !split1 || !split2) throw new Error("Expected 3 splits");
			// alice is payer (index 0), gets extra cent
			expect(split0.shareAmount).toBe(0.34); // payer
			expect(split1.shareAmount).toBe(0.33);
			expect(split2.shareAmount).toBe(0.33);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(100); // exact cent sum
		});

		it("$0.01 / 2 people → payer gets $0.01, other gets $0.00", async () => {
			const splits = await equalSplit(0.01, ["alice", "bob"]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(0.01); // payer gets the only cent
			expect(split1.shareAmount).toBe(0.0);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(1);
		});

		it("$999999.99 / 2 people → no overflow, sums correctly", async () => {
			const splits = await equalSplit(999999.99, ["alice", "bob"]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			// Total must sum back to $999999.99 (within floating point tolerance)
			expect(Math.round(total * 100)).toBe(99999999);
			// Payer (alice) gets the extra cent
			expect(split0.shareAmount).toBeGreaterThan(split1.shareAmount);
		});
	});

	// ── split mode: EXACT ────────────────────────────────────────────────────

	describe("computeExactSplits (via create)", () => {
		it("$100 with one participant paying $0 is valid", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 100,
				currency: "USD",
				description: "Alice covers everything",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice", shareAmount: 100 },
					{ participantType: "user", participantId: "bob", shareAmount: 0 },
				],
				splitMode: "EXACT",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const splits = firstCall[0].data.splitParticipants.create;
			expect(splits[0].shareAmount).toBe(100);
			expect(splits[1].shareAmount).toBe(0);
		});

		it("$100 with $33.33 + $33.33 + $33.34 → valid (sums to $100.00)", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 100,
				currency: "USD",
				description: "3-way exact",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: 33.34,
					},
					{ participantType: "user", participantId: "bob", shareAmount: 33.33 },
					{
						participantType: "user",
						participantId: "carol",
						shareAmount: 33.33,
					},
				],
				splitMode: "EXACT",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const splits = firstCall[0].data.splitParticipants.create;
			expect(
				splits[0].shareAmount + splits[1].shareAmount + splits[2].shareAmount,
			).toBe(100);
		});

		it("rejects $100 with $60 + $50 = $110 (sum exceeds total)", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Bad split",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{
							participantType: "user",
							participantId: "alice",
							shareAmount: 60,
						},
						{ participantType: "user", participantId: "bob", shareAmount: 50 },
					],
					splitMode: "EXACT",
				}),
			).rejects.toThrow("Split amounts must sum to the transaction amount");
		});

		it("rejects $100 with $60 + $30 = $90 (sum below total)", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Bad split",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{
							participantType: "user",
							participantId: "alice",
							shareAmount: 60,
						},
						{ participantType: "user", participantId: "bob", shareAmount: 30 },
					],
					splitMode: "EXACT",
				}),
			).rejects.toThrow("Split amounts must sum to the transaction amount");
		});

		it("rejects a participant with no shareAmount as a validation error", async () => {
			const { db, txClient } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			// bob's missing amount would count as 0 and pass the sum check.
			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Missing share",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{ participantType: "user", participantId: "alice", shareAmount: 100 },
						{ participantType: "user", participantId: "bob" },
					],
					splitMode: "EXACT",
				}),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining("missing shareAmount"),
			});
			expect(txClient.sharedTransaction.create).not.toHaveBeenCalled();
		});
	});

	// ── split mode: PERCENTAGE ───────────────────────────────────────────────

	describe("computePercentageSplits (via create)", () => {
		async function percentageSplit(
			amount: number,
			participants: Array<{ id: string; pct: number }>,
			payerIdArg?: string,
		) {
			const firstParticipant = participants[0];
			if (!firstParticipant) throw new Error("participants cannot be empty");
			const payerId = payerIdArg ?? firstParticipant.id;
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: payerId,
			});
			await service.create({
				amount,
				currency: "USD",
				description: "Test",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: payerId },
				splitWith: participants.map((p) => ({
					participantType: "user" as const,
					participantId: p.id,
					sharePercentage: p.pct,
				})),
				splitMode: "PERCENTAGE",
			});
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			return firstCall[0].data.splitParticipants.create as Array<{
				participantId: string;
				shareAmount: number;
			}>;
		}

		it("50/50 on $100 → $50/$50", async () => {
			const splits = await percentageSplit(100, [
				{ id: "alice", pct: 50 },
				{ id: "bob", pct: 50 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(50);
			expect(split1.shareAmount).toBe(50);
		});

		it("60/40 on $100 → $60/$40", async () => {
			const splits = await percentageSplit(100, [
				{ id: "alice", pct: 60 },
				{ id: "bob", pct: 40 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(60);
			expect(split1.shareAmount).toBe(40);
		});

		it("33.33/33.33/33.34 on $100 → amounts sum to exactly $100", async () => {
			const splits = await percentageSplit(100, [
				{ id: "alice", pct: 33.33 },
				{ id: "bob", pct: 33.33 },
				{ id: "carol", pct: 33.34 },
			]);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(10000);
		});

		it("50/50 on $33.33 → payer gets $16.67, other gets $16.66", async () => {
			const splits = await percentageSplit(33.33, [
				{ id: "alice", pct: 50 },
				{ id: "bob", pct: 50 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			// alice is payer, gets extra cent
			expect(split0.shareAmount).toBe(16.67);
			expect(split1.shareAmount).toBe(16.66);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(3333);
		});

		it("100/0 on $50 → $50/$0 (one person owes full amount)", async () => {
			const splits = await percentageSplit(50, [
				{ id: "alice", pct: 100 },
				{ id: "bob", pct: 0 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(50);
			expect(split1.shareAmount).toBe(0);
		});

		it("0/0/100 on $50 → $0/$0/$50 (valid: non-payer carries full share)", async () => {
			// carol pays, and also bears 100% of the cost
			const splits = await percentageSplit(
				50,
				[
					{ id: "alice", pct: 0 },
					{ id: "bob", pct: 0 },
					{ id: "carol", pct: 100 },
				],
				"carol",
			);
			const aliceSplit = splits.find((s) => s.participantId === "alice");
			const bobSplit = splits.find((s) => s.participantId === "bob");
			const carolSplit = splits.find((s) => s.participantId === "carol");
			if (!aliceSplit || !bobSplit || !carolSplit)
				throw new Error("Expected 3 splits");
			expect(aliceSplit.shareAmount).toBe(0);
			expect(bobSplit.shareAmount).toBe(0);
			expect(carolSplit.shareAmount).toBe(50);
		});

		it("50/50/1 (sum 101%) → rejects", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Test",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{
							participantType: "user",
							participantId: "alice",
							sharePercentage: 50,
						},
						{
							participantType: "user",
							participantId: "bob",
							sharePercentage: 50,
						},
						{
							participantType: "user",
							participantId: "carol",
							sharePercentage: 1,
						},
					],
					splitMode: "PERCENTAGE",
				}),
			).rejects.toThrow("Percentages must sum to 100");
		});

		it("50/40 (sum 90%) → rejects", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Test",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{
							participantType: "user",
							participantId: "alice",
							sharePercentage: 50,
						},
						{
							participantType: "user",
							participantId: "bob",
							sharePercentage: 40,
						},
					],
					splitMode: "PERCENTAGE",
				}),
			).rejects.toThrow("Percentages must sum to 100");
		});

		it("missing sharePercentage → rejects", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Test",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{ participantType: "user", participantId: "alice" }, // no sharePercentage
						{
							participantType: "user",
							participantId: "bob",
							sharePercentage: 50,
						},
					],
					splitMode: "PERCENTAGE",
				}),
			).rejects.toThrow("missing sharePercentage");
		});
	});

	// ── split mode: SHARES ───────────────────────────────────────────────────

	describe("computeSharesSplits (via create)", () => {
		async function sharesSplit(
			amount: number,
			participants: Array<{ id: string; units: number }>,
			payerIdArg?: string,
		) {
			const firstParticipant = participants[0];
			if (!firstParticipant) throw new Error("participants cannot be empty");
			const payerId = payerIdArg ?? firstParticipant.id;
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: payerId,
			});
			await service.create({
				amount,
				currency: "USD",
				description: "Test",
				date: new Date("2026-03-01"),
				paidBy: { participantType: "user", participantId: payerId },
				splitWith: participants.map((p) => ({
					participantType: "user" as const,
					participantId: p.id,
					shareUnits: p.units,
				})),
				splitMode: "SHARES",
			});
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			return firstCall[0].data.splitParticipants.create as Array<{
				participantId: string;
				shareAmount: number;
			}>;
		}

		it("1:1 on $100 → $50/$50 (same as equal split)", async () => {
			const splits = await sharesSplit(100, [
				{ id: "alice", units: 1 },
				{ id: "bob", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(50);
			expect(split1.shareAmount).toBe(50);
		});

		it("2:1 on $90 → $60/$30", async () => {
			const splits = await sharesSplit(90, [
				{ id: "alice", units: 2 },
				{ id: "bob", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(60);
			expect(split1.shareAmount).toBe(30);
		});

		it("1:1:1 on $100 → same as 3-way equal (payer gets extra cent)", async () => {
			const splits = await sharesSplit(100, [
				{ id: "alice", units: 1 },
				{ id: "bob", units: 1 },
				{ id: "carol", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			const split2 = splits[2];
			if (!split0 || !split1 || !split2) throw new Error("Expected 3 splits");
			expect(split0.shareAmount).toBe(33.34); // alice (payer)
			expect(split1.shareAmount).toBe(33.33);
			expect(split2.shareAmount).toBe(33.33);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(10000);
		});

		it("3:1 on $100 → $75/$25", async () => {
			const splits = await sharesSplit(100, [
				{ id: "alice", units: 3 },
				{ id: "bob", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(75);
			expect(split1.shareAmount).toBe(25);
		});

		it("1:1 on $33.33 → payer gets $16.67, other gets $16.66", async () => {
			const splits = await sharesSplit(33.33, [
				{ id: "alice", units: 1 },
				{ id: "bob", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(16.67); // alice (payer)
			expect(split1.shareAmount).toBe(16.66);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(3333);
		});

		it("10:1 on $100 → payer gets $90.91, other gets $9.09", async () => {
			// totalCents=10000, totalUnits=11
			// alice: floor(10000*10/11)=9090 cents + 1 remainder cent = 9091 = $90.91
			// bob:   floor(10000*1/11) =  909 cents = $9.09
			const splits = await sharesSplit(100, [
				{ id: "alice", units: 10 },
				{ id: "bob", units: 1 },
			]);
			const split0 = splits[0];
			const split1 = splits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(90.91);
			expect(split1.shareAmount).toBe(9.09);
			const total = splits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(10000);
		});

		it("missing shareUnits → rejects", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.create({
					amount: 100,
					currency: "USD",
					description: "Test",
					date: new Date("2026-03-01"),
					paidBy: { participantType: "user", participantId: "alice" },
					splitWith: [
						{ participantType: "user", participantId: "alice" }, // no shareUnits
						{ participantType: "user", participantId: "bob", shareUnits: 1 },
					],
					splitMode: "SHARES",
				}),
			).rejects.toThrow("shareUnits >= 1");
		});
	});

	// ── characterization: current server split behavior (safety net) ─────────
	// These lock the CURRENT server output for the edge cases the health audit
	// flags as divergence risks, so the shared-split extraction can be proven
	// behavior-preserving. The server rounding rule (remainder to the payer,
	// else the first row) is the canonical source of truth for what gets saved.
	describe("split characterization (server = source of truth)", () => {
		async function splitViaCreate(input: {
			amount: number;
			splitMode: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
			payer: { participantType: "user" | "guest" | "shadow"; participantId: string };
			splitWith: Array<{
				participantType: "user" | "guest" | "shadow";
				participantId: string;
				shareAmount?: number;
				sharePercentage?: number;
				shareUnits?: number;
			}>;
		}) {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});
			const service = new SharedTransactionService(db as never, input.payer);
			await service.create({
				amount: input.amount,
				currency: "USD",
				description: "Test",
				date: new Date("2026-03-01"),
				paidBy: input.payer,
				splitWith: input.splitWith,
				splitMode: input.splitMode,
			});
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			return firstCall[0].data.splitParticipants.create as Array<{
				participantType: string;
				participantId: string;
				shareAmount: number;
				sharePercentage: number | null;
				shareUnits: number | null;
			}>;
		}

		it("EQUAL, payer NOT in split, indivisible: remainder goes to first row", async () => {
			// $100 / 3 debtors, alice pays but is not a debtor. The payer has no
			// row, so the extra cent lands on the first split row (bob).
			const splits = await splitViaCreate({
				amount: 100,
				splitMode: "EQUAL",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "bob" },
					{ participantType: "user", participantId: "carol" },
					{ participantType: "user", participantId: "dave" },
				],
			});
			expect(splits).toHaveLength(3);
			expect(splits.map((s) => s.shareAmount)).toEqual([33.34, 33.33, 33.33]);
			expect(Math.round(splits.reduce((a, s) => a + s.shareAmount, 0) * 100)).toBe(
				10000,
			);
		});

		it("EQUAL, single participant, payer outside: debtor owes the full amount", async () => {
			const splits = await splitViaCreate({
				amount: 42.5,
				splitMode: "EQUAL",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [{ participantType: "user", participantId: "bob" }],
			});
			expect(splits).toHaveLength(1);
			expect(splits[0]!.participantId).toBe("bob");
			expect(splits[0]!.shareAmount).toBe(42.5);
		});

		it("EQUAL with a guest and a shadow present: types preserved, payer gets remainder", async () => {
			// $10 / 3 (alice user payer, a guest, a shadow). Divides evenly to
			// $3.33 with 1 remainder cent going to the payer (alice).
			const splits = await splitViaCreate({
				amount: 10,
				splitMode: "EQUAL",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "guest", participantId: "g1" },
					{ participantType: "shadow", participantId: "s1" },
				],
			});
			expect(splits).toHaveLength(3);
			const alice = splits.find((s) => s.participantId === "alice")!;
			const guest = splits.find((s) => s.participantId === "g1")!;
			const shadow = splits.find((s) => s.participantId === "s1")!;
			expect(guest.participantType).toBe("guest");
			expect(shadow.participantType).toBe("shadow");
			expect(alice.shareAmount).toBe(3.34); // payer takes the extra cent
			expect(guest.shareAmount).toBe(3.33);
			expect(shadow.shareAmount).toBe(3.33);
			expect(Math.round(splits.reduce((a, s) => a + s.shareAmount, 0) * 100)).toBe(
				1000,
			);
		});

		it("SHARES, payer NOT in split: remainder falls to the LAST row", async () => {
			// $100, units 10:1, payer alice is outside the split. In SHARES (and
			// PERCENTAGE), when the payer has no row the remainder cent lands on the
			// LAST split row (idx = length - 1), not the first. This differs from the
			// EQUAL path, which fills remaining rows from index 0. Locking it here.
			const splits = await splitViaCreate({
				amount: 100,
				splitMode: "SHARES",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "bob", shareUnits: 10 },
					{ participantType: "user", participantId: "carol", shareUnits: 1 },
				],
			});
			const bob = splits.find((s) => s.participantId === "bob")!;
			const carol = splits.find((s) => s.participantId === "carol")!;
			expect(bob.shareAmount).toBe(90.9); // floor 9090 cents, no remainder here
			expect(carol.shareAmount).toBe(9.1); // floor 909 + remainder cent → last row
			expect(bob.shareUnits).toBe(10);
			expect(carol.shareUnits).toBe(1);
			expect(Math.round(splits.reduce((a, s) => a + s.shareAmount, 0) * 100)).toBe(
				10000,
			);
		});

		it("PERCENTAGE preserves sharePercentage on the saved rows", async () => {
			const splits = await splitViaCreate({
				amount: 100,
				splitMode: "PERCENTAGE",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice", sharePercentage: 60 },
					{ participantType: "user", participantId: "bob", sharePercentage: 40 },
				],
			});
			const alice = splits.find((s) => s.participantId === "alice")!;
			const bob = splits.find((s) => s.participantId === "bob")!;
			expect(alice.shareAmount).toBe(60);
			expect(bob.shareAmount).toBe(40);
			expect(alice.sharePercentage).toBe(60);
			expect(bob.sharePercentage).toBe(40);
		});

		it("EXACT preserves the exact per-row amounts", async () => {
			const splits = await splitViaCreate({
				amount: 100,
				splitMode: "EXACT",
				payer: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice", shareAmount: 70 },
					{ participantType: "user", participantId: "bob", shareAmount: 30 },
				],
			});
			expect(splits.find((s) => s.participantId === "alice")!.shareAmount).toBe(70);
			expect(splits.find((s) => s.participantId === "bob")!.shareAmount).toBe(30);
		});
	});

	// ── update: auto-recalculation on amount change ──────────────────────────

	describe("update recalculation on amount change", () => {
		it("EQUAL mode: changing amount recalculates shares equally", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 90 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EQUAL",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 45 },
						sharePercentage: null,
						shareUnits: null,
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 45 },
						sharePercentage: null,
						shareUnits: null,
					},
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: 100,
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: 100,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({ id: "txn-1", amount: 100 });

			// Split participants should be replaced with new $50/$50 split
			expect(txClient.splitParticipant.deleteMany).toHaveBeenCalled();
			expect(txClient.splitParticipant.createMany).toHaveBeenCalled();
			const createManyCallArr = txClient.splitParticipant.createMany.mock.calls[0];
			if (!createManyCallArr) throw new Error("Expected createMany Call");
			const createManyCall = createManyCallArr[0];
			const newSplits = createManyCall.data as Array<{
				participantId: string;
				shareAmount: number;
			}>;
			const split0 = newSplits[0];
			const split1 = newSplits[1];
			if (!split0 || !split1) throw new Error("Expected 2 splits");
			expect(split0.shareAmount).toBe(50);
			expect(split1.shareAmount).toBe(50);
		});

		it("PERCENTAGE mode: changing amount recalculates using stored percentages", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 100 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "PERCENTAGE",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 60 },
						sharePercentage: { toNumber: () => 60 },
						shareUnits: null,
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 40 },
						sharePercentage: { toNumber: () => 40 },
						shareUnits: null,
					},
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: 200,
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: 200,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({ id: "txn-1", amount: 200 });

			// 60% of $200 = $120, 40% of $200 = $80
			const createManyCallArr = txClient.splitParticipant.createMany.mock.calls[0];
			if (!createManyCallArr) throw new Error("Expected createMany Call");
			const createManyCall = createManyCallArr[0];
			const newSplits = createManyCall.data as Array<{
				participantId: string;
				shareAmount: number;
			}>;
			const aliceSplit = newSplits.find((s) => s.participantId === "alice");
			const bobSplit = newSplits.find((s) => s.participantId === "bob");
			if (!aliceSplit || !bobSplit) throw new Error("Expected splits for alice and bob");
			expect(aliceSplit.shareAmount).toBe(120);
			expect(bobSplit.shareAmount).toBe(80);
		});

		it("SHARES mode: changing amount recalculates using stored shareUnits", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 90 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "SHARES",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 60 },
						sharePercentage: null,
						shareUnits: 2,
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 30 },
						sharePercentage: null,
						shareUnits: 1,
					},
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: 120,
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: 120,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({ id: "txn-1", amount: 120 });

			// 2:1 on $120 → alice $80, bob $40
			const createManyCallArr = txClient.splitParticipant.createMany.mock.calls[0];
			if (!createManyCallArr) throw new Error("Expected createMany Call");
			const createManyCall = createManyCallArr[0];
			const newSplits = createManyCall.data as Array<{
				participantId: string;
				shareAmount: number;
			}>;
			const aliceSplit = newSplits.find((s) => s.participantId === "alice");
			const bobSplit = newSplits.find((s) => s.participantId === "bob");
			if (!aliceSplit || !bobSplit) throw new Error("Expected splits for alice and bob");
			expect(aliceSplit.shareAmount).toBe(80);
			expect(bobSplit.shareAmount).toBe(40);
		});

		// EXACT shares used to go stale when the amount changed (their sum no
		// longer matched the amount — silent corruption). They are now rescaled
		// proportionally to the new amount.
		function exactRescaleExisting(
			oldAmount: number,
			shares: Array<{ id: string; amount: number }>,
		) {
			return {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => oldAmount },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EXACT",
				notes: null,
				receiptUrl: null,
				projectId: null,
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: shares.map((s) => ({
					participantType: "user",
					participantId: s.id,
					shareAmount: { toNumber: () => s.amount },
					sharePercentage: null,
					shareUnits: null,
				})),
			};
		}

		async function runExactRescale(
			oldAmount: number,
			shares: Array<{ id: string; amount: number }>,
			newAmount: number,
		) {
			const { db, txClient } = createMockDb();
			const existing = exactRescaleExisting(oldAmount, shares);
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: newAmount,
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: newAmount,
				splitParticipants: [],
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({ id: "txn-1", amount: newAmount });
			const call = txClient.splitParticipant.createMany.mock.calls[0];
			if (!call) throw new Error("Expected createMany to be called");
			return call[0].data as Array<{ participantId: string; shareAmount: number }>;
		}

		it("EXACT mode: amount change rescales shares proportionally ($100 [40/60] → $200 [80/120])", async () => {
			const newSplits = await runExactRescale(
				100,
				[
					{ id: "alice", amount: 40 },
					{ id: "bob", amount: 60 },
				],
				200,
			);
			const alice = newSplits.find((s) => s.participantId === "alice");
			const bob = newSplits.find((s) => s.participantId === "bob");
			if (!alice || !bob) throw new Error("Expected alice and bob splits");
			expect(alice.shareAmount).toBe(80);
			expect(bob.shareAmount).toBe(120);
			expect(alice.shareAmount + bob.shareAmount).toBe(200);
		});

		it("EXACT mode: rescale keeps the sum equal to the amount with indivisible cents", async () => {
			// $100 [60/40] → $100.01: 60% = 60.006 → floor 60.00, 40% = 40.004 →
			// floor 40.00, remainder cent goes to the payer (alice).
			const newSplits = await runExactRescale(
				100,
				[
					{ id: "alice", amount: 60 },
					{ id: "bob", amount: 40 },
				],
				100.01,
			);
			const total = newSplits.reduce((s, p) => s + p.shareAmount, 0);
			expect(Math.round(total * 100)).toBe(10001);
			const alice = newSplits.find((s) => s.participantId === "alice");
			expect(alice!.shareAmount).toBe(60.01); // payer absorbs the remainder cent
		});

		it("EXACT mode: amount change replaces the split rows (deleteMany + createMany)", async () => {
			const { db, txClient } = createMockDb();
			const existing = exactRescaleExisting(100, [
				{ id: "alice", amount: 60 },
				{ id: "bob", amount: 40 },
			]);
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.update.mockResolvedValue({
				...existing,
				amount: 120,
			});
			txClient.sharedTransaction.findUniqueOrThrow.mockResolvedValue({
				...existing,
				amount: 120,
				splitParticipants: [],
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({ id: "txn-1", amount: 120 });
			expect(txClient.splitParticipant.deleteMany).toHaveBeenCalled();
			expect(txClient.splitParticipant.createMany).toHaveBeenCalled();
		});
	});

	// ── create/update parity in a project (membership + shadow auto-add) ─────

	describe("update parity: project membership + shadow auto-add", () => {
		function projectExisting(splitParticipants: Array<Record<string, unknown>>) {
			return {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 100 },
				currency: "USD",
				date: new Date("2026-03-01"),
				categoryId: null,
				splitMode: "EQUAL",
				notes: null,
				receiptUrl: null,
				projectId: "proj-1",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants,
			};
		}

		function mockUpdateDb(opts: {
			existing: Record<string, unknown>;
			// project members recognized by validateProjectMembership
			members: Array<{ participantType: string; participantId: string }>;
			// existing shadow rows in projectParticipant (for auto-add dedupe)
			existingShadowIds?: string[];
			// shadowId -> createdById (who may bring the shadow into a project)
			shadowCreators?: Record<string, string>;
			// shadowId -> other projects the shadow is already in
			shadowProjects?: Record<string, string[]>;
			// projectId -> alice's role there (default ORGANIZER; null = not a member)
			actorRoles?: Record<string, string | null>;
			// projectId -> id of its OPEN billing period
			openPeriods?: Record<string, string>;
		}) {
			const shadowSet = new Set(opts.existingShadowIds ?? []);
			const created: Array<Record<string, unknown>> = [];
			const actorRole = (projectId: string) =>
				opts.actorRoles && projectId in opts.actorRoles
					? opts.actorRoles[projectId]!
					: "ORGANIZER";
			const txClient = {
				$executeRaw: vi.fn().mockResolvedValue(undefined),
				sharedTransaction: {
					create: vi.fn(),
					findUnique: vi.fn().mockResolvedValue(opts.existing),
					findUniqueOrThrow: vi
						.fn()
						.mockResolvedValue({ ...opts.existing, splitParticipants: [] }),
					update: vi.fn().mockResolvedValue(opts.existing),
					delete: vi.fn(),
				},
				splitParticipant: {
					createMany: vi.fn(),
					deleteMany: vi.fn(),
					updateMany: vi.fn(),
					findMany: vi.fn().mockResolvedValue([]),
				},
				projectParticipant: {
					// Used both by assertCanModifyTransaction (actor role) and by the
					// shadow auto-add dedupe check.
					findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
						const key = args.where.projectId_participantType_participantId as
							| { projectId: string; participantType: string; participantId: string }
							| undefined;
						if (key?.participantType === "shadow") {
							return shadowSet.has(key.participantId)
								? { ...key, id: `pp-${key.participantId}`, role: "CONTRIBUTOR" }
								: null;
						}
						// actor membership (alice is an ORGANIZER by default, can edit)
						const projectId = key?.projectId ?? "proj-1";
						const role = actorRole(projectId);
						return role === null
							? null
							: {
									projectId,
									participantType: "user",
									participantId: "alice",
									role,
								};
					}),
					findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
						const where = args.where;
						// a shadow's other projects (assertShadowsAddable)
						if (where.participantType === "shadow") {
							const ids = opts.shadowProjects?.[where.participantId as string] ?? [];
							return ids.map((projectId) => ({ projectId }));
						}
						// alice's memberships across those projects
						if (where.participantType === "user") {
							const ids = (where.projectId as { in: string[] }).in;
							return ids
								.map((projectId) => ({ projectId, role: actorRole(projectId) }))
								.filter((r) => r.role !== null);
						}
						// validateProjectMembership
						return opts.members.map((m) => ({
							participantType: m.participantType,
							participantId: m.participantId,
						}));
					}),
					create: vi.fn(async (args: { data: Record<string, unknown> }) => {
						created.push(args.data);
						return args.data;
					}),
				},
				shadowProfile: {
					findUnique: vi.fn(async (args: { where: { id: string } }) => {
						const createdById = opts.shadowCreators?.[args.where.id];
						return createdById ? { createdById } : null;
					}),
				},
				project: {
					findUnique: vi.fn().mockResolvedValue({ autoAcceptSplits: true }),
				},
				billingPeriod: {
					findFirst: vi.fn(async (args: { where: { projectId: string } }) => {
						const id = opts.openPeriods?.[args.where.projectId];
						return id ? { id, startDate: new Date("2026-01-01") } : null;
					}),
				},
				auditLogEntry: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
			};
			const db = {
				$transaction: vi.fn(
					async (cb: (tx: typeof txClient) => Promise<unknown>) =>
						await cb(txClient),
				),
			};
			return { db, txClient, created };
		}

		const ALICE_ONLY = [
			{
				participantType: "user",
				participantId: "alice",
				shareAmount: { toNumber: () => 100 },
				sharePercentage: null,
				shareUnits: null,
			},
		];
		const alice = { participantType: "user" as const, participantId: "alice" };

		it("refuses to pull in a shadow the editor has no relationship with", async () => {
			const { db, created } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				shadowCreators: { "shadow-x": "someone-else" },
				shadowProjects: { "shadow-x": ["proj-other"] },
				actorRoles: { "proj-other": null },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({
					id: "txn-1",
					splitWith: [alice, { participantType: "shadow", participantId: "shadow-x" }],
					splitMode: "EQUAL",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(created).toHaveLength(0);
		});

		it("refuses a shadow the editor only views elsewhere", async () => {
			const { db } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				shadowCreators: { "shadow-x": "someone-else" },
				shadowProjects: { "shadow-x": ["proj-other"] },
				actorRoles: { "proj-other": "VIEWER" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({
					id: "txn-1",
					splitWith: [alice, { participantType: "shadow", participantId: "shadow-x" }],
					splitMode: "EQUAL",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("refuses a shadow from another project where the editor only contributes", async () => {
			const { db, created } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				shadowCreators: { "shadow-x": "someone-else" },
				shadowProjects: { "shadow-x": ["proj-other"] },
				actorRoles: { "proj-other": "CONTRIBUTOR" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({
					id: "txn-1",
					splitWith: [alice, { participantType: "shadow", participantId: "shadow-x" }],
					splitMode: "EQUAL",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(created).toHaveLength(0);
		});

		it("lets a contributor use a shadow that is already in this project", async () => {
			const { db, txClient, created } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				existingShadowIds: ["shadow-x"],
				shadowCreators: { "shadow-x": "someone-else" },
				actorRoles: { "proj-1": "CONTRIBUTOR" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await service.update({
				id: "txn-1",
				splitWith: [alice, { participantType: "shadow", participantId: "shadow-x" }],
				splitMode: "EQUAL",
			});
			expect(txClient.splitParticipant.createMany).toHaveBeenCalled();
			expect(created).toHaveLength(0);
		});

		it("allows a shadow from another project the editor manages", async () => {
			const { db, created } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				shadowCreators: { "shadow-x": "someone-else" },
				shadowProjects: { "shadow-x": ["proj-other"] },
				actorRoles: { "proj-other": "EDITOR" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await service.update({
				id: "txn-1",
				splitWith: [alice, { participantType: "shadow", participantId: "shadow-x" }],
				splitMode: "EQUAL",
			});
			expect(created.map((c) => c.participantId)).toEqual(["shadow-x"]);
		});

		it("create: a guest cannot bring a shadow from outside their project", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "guest", participantId: "guest-1" }],
				shadowCreators: { "shadow-x": "someone" },
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "guest",
				participantId: "guest-1",
			});
			await expect(
				service.create({
					amount: 10,
					currency: "USD",
					description: "Snacks",
					date: new Date("2026-03-02"),
					paidBy: { participantType: "guest", participantId: "guest-1" },
					splitWith: [
						{ participantType: "guest", participantId: "guest-1" },
						{ participantType: "shadow", participantId: "shadow-x" },
					],
					splitMode: "EQUAL",
					projectId: "proj-1",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(txClient.sharedTransaction.create).not.toHaveBeenCalled();
		});

		it("create: a shadow already in the project is fine for anyone", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "guest", participantId: "guest-1" }],
				existingShadowIds: ["shadow-x"],
			});
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-2",
				splitParticipants: [],
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "guest",
				participantId: "guest-1",
			});
			await service.create({
				amount: 10,
				currency: "USD",
				description: "Snacks",
				date: new Date("2026-03-02"),
				paidBy: { participantType: "guest", participantId: "guest-1" },
				splitWith: [
					{ participantType: "guest", participantId: "guest-1" },
					{ participantType: "shadow", participantId: "shadow-x" },
				],
				splitMode: "EQUAL",
				projectId: "proj-1",
			});
			expect(txClient.sharedTransaction.create).toHaveBeenCalled();
		});

		it("checks a shadow payer too, even when only the payer changes", async () => {
			const { db } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({
					id: "txn-1",
					paidBy: { participantType: "shadow", participantId: "shadow-x" },
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("rejects a payer-only change to someone outside the project", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({
					id: "txn-1",
					paidBy: { participantType: "user", participantId: "mallory" },
				}),
			).rejects.toThrow("is not a member of this project");
			expect(txClient.sharedTransaction.update).not.toHaveBeenCalled();
		});

		it("refuses to move an expense into a project where the editor is only a viewer", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				actorRoles: { "proj-2": "VIEWER" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({ id: "txn-1", projectId: "proj-2" }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(txClient.sharedTransaction.update).not.toHaveBeenCalled();
		});

		it("refuses to move an expense into a project the editor is not in", async () => {
			const { db } = mockUpdateDb({
				existing: projectExisting(ALICE_ONLY),
				members: [{ participantType: "user", participantId: "alice" }],
				actorRoles: { "proj-2": null },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({ id: "txn-1", projectId: "proj-2" }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("moving projects re-checks the existing split against the target", async () => {
			const { db } = mockUpdateDb({
				existing: projectExisting([
					...ALICE_ONLY,
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 0 },
						sharePercentage: null,
						shareUnits: null,
					},
				]),
				// bob is not in the target project
				members: [{ participantType: "user", participantId: "alice" }],
				actorRoles: { "proj-2": "CONTRIBUTOR" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await expect(
				service.update({ id: "txn-1", projectId: "proj-2" }),
			).rejects.toThrow("is not a member of this project");
		});

		it("moving projects puts the expense in the target's open billing period", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: { ...projectExisting(ALICE_ONLY), billingPeriodId: "bp-old" },
				members: [{ participantType: "user", participantId: "alice" }],
				actorRoles: { "proj-2": "CONTRIBUTOR" },
				openPeriods: { "proj-2": "bp-new" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await service.update({ id: "txn-1", projectId: "proj-2" });
			expect(txClient.sharedTransaction.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						projectId: "proj-2",
						billingPeriodId: "bp-new",
					}),
				}),
			);
		});

		it("moving projects clears the billing period when the target has none open", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: { ...projectExisting(ALICE_ONLY), billingPeriodId: "bp-old" },
				members: [{ participantType: "user", participantId: "alice" }],
				actorRoles: { "proj-2": "CONTRIBUTOR" },
			});
			const service = new SharedTransactionService(db as never, alice);
			await service.update({ id: "txn-1", projectId: "proj-2" });
			expect(txClient.sharedTransaction.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						projectId: "proj-2",
						billingPeriodId: null,
					}),
				}),
			);
		});

		it("rejects an edit that adds a non-member user to the split (parity with create)", async () => {
			const { db } = mockUpdateDb({
				existing: projectExisting([
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 50 },
						sharePercentage: null,
						shareUnits: null,
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 50 },
						sharePercentage: null,
						shareUnits: null,
					},
				]),
				// only alice and bob are members; "mallory" is not
				members: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(
				service.update({
					id: "txn-1",
					splitWith: [
						{ participantType: "user", participantId: "alice" },
						{ participantType: "user", participantId: "mallory" },
					],
					splitMode: "EQUAL",
				}),
			).rejects.toThrow("is not a member of this project");
		});

		it("allows an edit whose split members are all project members", async () => {
			const { db, txClient } = mockUpdateDb({
				existing: projectExisting([
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 100 },
						sharePercentage: null,
						shareUnits: null,
					},
				]),
				members: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
				splitMode: "EQUAL",
			});
			expect(txClient.splitParticipant.createMany).toHaveBeenCalled();
		});

		it("auto-adds a new shadow to the project roster on edit (parity with create)", async () => {
			const { db, created } = mockUpdateDb({
				existing: projectExisting([
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 100 },
						sharePercentage: null,
						shareUnits: null,
					},
				]),
				members: [{ participantType: "user", participantId: "alice" }],
				existingShadowIds: [], // shadow-1 not yet in the project
				shadowCreators: { "shadow-1": "alice" }, // alice's own contact
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "shadow", participantId: "shadow-1" },
				],
				splitMode: "EQUAL",
			});
			// The shadow was added to projectParticipant as a CONTRIBUTOR.
			const addedShadow = created.find(
				(c) => c.participantType === "shadow" && c.participantId === "shadow-1",
			);
			expect(addedShadow).toBeDefined();
			expect(addedShadow!.role).toBe("CONTRIBUTOR");
			expect(addedShadow!.projectId).toBe("proj-1");
		});

		it("does not duplicate a shadow that is already in the project", async () => {
			const { db, created } = mockUpdateDb({
				existing: projectExisting([
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 100 },
						sharePercentage: null,
						shareUnits: null,
					},
				]),
				members: [{ participantType: "user", participantId: "alice" }],
				existingShadowIds: ["shadow-1"], // already a member
			});
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "shadow", participantId: "shadow-1" },
				],
				splitMode: "EQUAL",
			});
			expect(
				created.some((c) => c.participantType === "shadow"),
			).toBe(false);
		});
	});

	// ── billing period assignment (create with project) ──────────────────────

	describe("billing period assignment", () => {
		function createMockDbWithProject() {
			const txClient = {
				$executeRaw: vi.fn().mockResolvedValue(undefined),
				sharedTransaction: {
					create: vi.fn(),
					findUnique: vi.fn(),
					findUniqueOrThrow: vi.fn(),
					update: vi.fn(),
					delete: vi.fn(),
				},
				splitParticipant: {
					createMany: vi.fn(),
					deleteMany: vi.fn(),
					updateMany: vi.fn(),
				},
				projectParticipant: {
					findUnique: vi.fn().mockResolvedValue({
						projectId: "proj-1",
						participantType: "user",
						participantId: "alice",
						role: "CONTRIBUTOR",
					}),
					findMany: vi.fn().mockResolvedValue([
						{
							participantType: "user",
							participantId: "alice",
						},
						{
							participantType: "user",
							participantId: "bob",
						},
					]),
				},
				project: {
					findUnique: vi.fn(),
				},
				billingPeriod: {
					findFirst: vi.fn(),
				},
				auditLogEntry: {
					create: vi.fn().mockResolvedValue({ id: "audit-1" }),
				},
				shadowProfile: {
					findUnique: vi.fn(),
				},
			};

			const db = {
				$transaction: vi.fn(
					async (cb: (tx: typeof txClient) => Promise<unknown>) => {
						return await cb(txClient);
					},
				),
			};

			return { db, txClient };
		}

		it("project with open period: assigns billingPeriodId", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.billingPeriod.findFirst.mockResolvedValue({
				id: "period-1",
				label: "March 2026",
				startDate: new Date("2026-03-01"),
				status: "OPEN",
			});
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			const result = await service.create({
				amount: 50,
				currency: "USD",
				description: "Groceries",
				date: new Date("2026-03-15"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
				splitMode: "EQUAL",
				projectId: "proj-1",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const createCall = firstCall[0];
			expect(createCall.data.billingPeriodId).toBe("period-1");
			expect(result.backdatedWarning).toBeNull();
		});

		it("project with backdated date: returns backdatedWarning", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.billingPeriod.findFirst.mockResolvedValue({
				id: "period-1",
				label: "March 2026",
				startDate: new Date("2026-03-01"),
				status: "OPEN",
			});
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			const result = await service.create({
				amount: 50,
				currency: "USD",
				description: "Old receipt",
				// Date predates the open period's start
				date: new Date("2026-02-15"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
				splitMode: "EQUAL",
				projectId: "proj-1",
			});

			// Transaction is still assigned to the open period
			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const createCall = firstCall[0];
			expect(createCall.data.billingPeriodId).toBe("period-1");
			// But a warning is returned to the caller
			expect(result.backdatedWarning).toEqual({ periodLabel: "March 2026" });
		});

		it("project with no open period: billingPeriodId remains null", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.billingPeriod.findFirst.mockResolvedValue(null); // no open period
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 50,
				currency: "USD",
				description: "Groceries",
				date: new Date("2026-03-15"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
				splitMode: "EQUAL",
				projectId: "proj-1",
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const createCall = firstCall[0];
			expect(createCall.data.billingPeriodId).toBeNull();
		});

		it("no projectId: billingPeriodId is null and no project queries run", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.create.mockResolvedValue({
				id: "txn-1",
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.create({
				amount: 50,
				currency: "USD",
				description: "Personal dinner",
				date: new Date("2026-03-15"),
				paidBy: { participantType: "user", participantId: "alice" },
				splitWith: [
					{ participantType: "user", participantId: "alice" },
					{ participantType: "user", participantId: "bob" },
				],
				splitMode: "EQUAL",
				// no projectId
			});

			const firstCall = txClient.sharedTransaction.create.mock.calls[0];
			if (!firstCall) throw new Error("Expected create to be called");
			const createCall = firstCall[0];
			expect(createCall.data.billingPeriodId).toBeNull();
		});
	});

	describe("delete", () => {
		beforeEach(() => {
			// Reset call history and default to no unsettled balance so delete
			// proceeds without confirmation unless a test says otherwise.
			vi.mocked(computeBalance).mockClear();
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} });
		});

		it("rejects delete by non-creator", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.findUnique.mockResolvedValue({
				id: "txn-1",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "bob",
			});
			await expect(service.delete("txn-1")).rejects.toThrow(
				"Only the creator can edit this expense",
			);
		});

		it("rejects delete on locked transaction", async () => {
			const { db, txClient } = createMockDb();
			txClient.sharedTransaction.findUnique.mockResolvedValue({
				id: "txn-1",
				createdByType: "user",
				createdById: "alice",
				isLocked: true,
				splitParticipants: [],
			});

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await expect(service.delete("txn-1")).rejects.toThrow(
				"Settled transactions cannot be modified",
			);
		});

		it("snapshots to audit log and hard-deletes when balance is settled", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: 50,
				currency: "USD",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				projectId: null,
				splitParticipants: [
					{ participantType: "user", participantId: "alice", shareAmount: 25 },
					{ participantType: "user", participantId: "bob", shareAmount: 25 },
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.delete.mockResolvedValue(existing);
			// bob has already repaid alice → no outstanding balance
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} });

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.delete("txn-1");

			// Audit log snapshot was created before deletion
			const firstAuditCall = txClient.auditLogEntry.create.mock.calls[0];
			if (!firstAuditCall) throw new Error("Expected audit log to be created");
			const auditCall = firstAuditCall[0];
			expect(auditCall.data.action).toBe("DELETED");
			expect(auditCall.data.changes).toHaveProperty("description", "Dinner");

			// Hard delete was performed
			expect(txClient.sharedTransaction.delete).toHaveBeenCalledWith({
				where: { id: "txn-1" },
			});
		});

		it("blocks delete when the expense still has an unsettled balance", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: 50,
				currency: "USD",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				projectId: null,
				splitParticipants: [
					{ participantType: "user", participantId: "alice", shareAmount: 25 },
					{ participantType: "user", participantId: "bob", shareAmount: 25 },
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			// bob still owes alice $25 in USD (computeBalance(alice, bob) positive)
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: 25 } });

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await expect(service.delete("txn-1")).rejects.toThrow(
				/unsettled balance/,
			);
			expect(txClient.sharedTransaction.delete).not.toHaveBeenCalled();
		});

		it("checks a project expense against that project's balance only", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: 50,
				currency: "USD",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				projectId: "proj-1",
				splitParticipants: [
					{ participantType: "user", participantId: "alice", shareAmount: 25 },
					{ participantType: "user", participantId: "bob", shareAmount: 25 },
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.delete.mockResolvedValue(existing);
			Object.assign(txClient, {
				projectParticipant: {
					findUnique: vi.fn().mockResolvedValue({ role: "ORGANIZER" }),
				},
			});
			// Settled within the project (bob may still owe alice elsewhere, but
			// that is not this expense's debt).
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} });

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.delete("txn-1");

			expect(computeBalance).toHaveBeenCalledWith(
				expect.anything(),
				{ participantType: "user", participantId: "alice" },
				{ participantType: "user", participantId: "bob" },
				{ projectScope: "proj-1" },
			);
			expect(txClient.sharedTransaction.delete).toHaveBeenCalled();
		});

		it("deletes an unsettled expense when confirmUnsettled is true", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: 50,
				currency: "USD",
				paidByType: "user",
				paidById: "alice",
				createdByType: "user",
				createdById: "alice",
				isLocked: false,
				projectId: null,
				splitParticipants: [
					{ participantType: "user", participantId: "alice", shareAmount: 25 },
					{ participantType: "user", participantId: "bob", shareAmount: 25 },
				],
			};
			txClient.sharedTransaction.findUnique.mockResolvedValue(existing);
			txClient.sharedTransaction.delete.mockResolvedValue(existing);
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: 25 } });

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await service.delete("txn-1", true);

			// computeBalance should not even be consulted when confirmed
			expect(computeBalance).not.toHaveBeenCalled();
			expect(txClient.sharedTransaction.delete).toHaveBeenCalledWith({
				where: { id: "txn-1" },
			});
		});
	});
});
