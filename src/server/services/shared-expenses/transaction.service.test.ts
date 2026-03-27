import { describe, expect, it, vi } from "vitest";

// Must be mocked before importing SharedTransactionService because the service
// module imports notifications at the top level, which transitively imports
// src/env.js (t3-env), which requires DATABASE_URL/BETTER_AUTH_SECRET to be set.
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

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

			// Creator's split is auto-accepted
			expect(splits[0].verificationStatus).toBe("ACCEPTED");
			expect(splits[1].verificationStatus).toBe("PENDING");
			expect(splits[2].verificationStatus).toBe("PENDING");

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

		it("rejects when payer is not in split participants", async () => {
			const { db } = createMockDb();
			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});

			await expect(
				service.create({
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
				}),
			).rejects.toThrow("The payer must be included in the split participants");
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

		it("description-only edit resets verification via updateMany", async () => {
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

			const service = new SharedTransactionService(db as never, {
				participantType: "user",
				participantId: "alice",
			});
			await service.update({
				id: "txn-1",
				description: "Dinner at Sotto",
			});

			// Splits did not change, so verification is reset via updateMany
			expect(txClient.splitParticipant.updateMany).toHaveBeenCalledWith({
				where: {
					transactionId: "txn-1",
					NOT: {
						participantType: "user",
						participantId: "alice",
					},
				},
				data: {
					verificationStatus: "PENDING",
					verifiedAt: null,
					rejectionReason: null,
				},
			});

			// deleteMany should NOT have been called (splits unchanged)
			expect(txClient.splitParticipant.deleteMany).not.toHaveBeenCalled();

			// Audit log has title diff
			const firstAuditCall = txClient.auditLogEntry.create.mock.calls[0];
			if (!firstAuditCall) throw new Error("Expected audit log to be created");
			const auditCall = firstAuditCall[0];
			expect(auditCall.data.action).toBe("EDITED");
			expect(auditCall.data.changes).toHaveProperty("title");
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

		it("EXACT mode: changing amount does NOT auto-recalculate splits", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: { toNumber: () => 100 },
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
				splitParticipants: [
					{
						participantType: "user",
						participantId: "alice",
						shareAmount: { toNumber: () => 60 },
						sharePercentage: null,
						shareUnits: null,
					},
					{
						participantType: "user",
						participantId: "bob",
						shareAmount: { toNumber: () => 40 },
						sharePercentage: null,
						shareUnits: null,
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

			// EXACT mode: no new participants created, only verification reset
			expect(txClient.splitParticipant.deleteMany).not.toHaveBeenCalled();
			expect(txClient.splitParticipant.createMany).not.toHaveBeenCalled();
			expect(txClient.splitParticipant.updateMany).toHaveBeenCalled(); // verification reset only
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

		it("ONGOING project with open period: assigns billingPeriodId", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.project.findUnique.mockResolvedValue({ type: "ONGOING" });
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

		it("ONGOING project with backdated date: returns backdatedWarning", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.project.findUnique.mockResolvedValue({ type: "ONGOING" });
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

		it("non-ONGOING project (ONEOFF): no billingPeriodId assigned", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.project.findUnique.mockResolvedValue({ type: "ONEOFF" });
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
				description: "Trip expense",
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
			// ONEOFF project skips billing period lookup entirely
			expect(createCall.data.billingPeriodId).toBeNull();
			expect(txClient.billingPeriod.findFirst).not.toHaveBeenCalled();
		});

		it("ONGOING project with no open period: billingPeriodId remains null", async () => {
			const { db, txClient } = createMockDbWithProject();
			txClient.project.findUnique.mockResolvedValue({ type: "ONGOING" });
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

		it("snapshots to audit log and hard-deletes", async () => {
			const { db, txClient } = createMockDb();
			const existing = {
				id: "txn-1",
				description: "Dinner",
				amount: 50,
				currency: "USD",
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
			expect(auditCall.data.changes).toHaveProperty("title", "Dinner");

			// Hard delete was performed
			expect(txClient.sharedTransaction.delete).toHaveBeenCalledWith({
				where: { id: "txn-1" },
			});
		});
	});
});
