import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBalance } from "./balance";
import { SettlementService } from "./settlement.service";

// Mock the notifications module: it uses the global DB and cannot run in unit tests.
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

// Mock computeBalance so settlement service tests control the balance independently
// of the balance module's own correctness (tested separately in balance.test.ts).
vi.mock("./balance", () => ({
	computeBalance: vi.fn(),
}));

// ── mock factory ───────────────────────────────────────────────────────────────

function createMockDb() {
	const iface = {
		settlement: {
			create: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn().mockResolvedValue([]),
			update: vi.fn(),
			delete: vi.fn(),
		},
		sharedTransaction: {
			count: vi.fn().mockResolvedValue(1), // relationship exists by default
		},
		shadowProfile: {
			findUnique: vi.fn().mockResolvedValue({ id: "shadow-1" }),
		},
		auditLogEntry: {
			create: vi.fn().mockResolvedValue({ id: "audit-1" }),
		},
	};

	return {
		...iface,
		$transaction: vi.fn(
			async <T>(cb: (tx: typeof iface) => Promise<T>) => {
				return cb(iface);
			},
		),
	};
}

const bob = { participantType: "user" as const, participantId: "bob" };
const shadow = {
	participantType: "shadow" as const,
	participantId: "shadow-1",
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe("SettlementService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: SettlementService;

	beforeEach(() => {
		db = createMockDb();
		service = new SettlementService(db as never, "alice");
		// Default: alice has no balance with bob (owes nothing)
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} });
	});

	// ── initiateSettlement ────────────────────────────────────────────────────

	describe("initiateSettlement", () => {
		it("creates a PROPOSED settlement with the correct fields", async () => {
			const mockSettlement = {
				id: "settle-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
				toParticipantType: "user",
				toParticipantId: "bob",
				amount: 30,
				currency: "USD",
				status: "PROPOSED",
				confirmedByPayer: true,
				confirmedByPayee: false,
			};
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } }); // alice owes bob $50
			db.settlement.create.mockResolvedValue(mockSettlement);

			const result = await service.initiateSettlement({
				toParticipant: bob,
				amount: 30,
				currency: "USD",
			});

			expect(result.settlement).toBe(mockSettlement);
			expect(result.warning).toBeNull();

			expect(db.settlement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					fromParticipantType: "user",
					fromParticipantId: "alice",
					toParticipantType: "user",
					toParticipantId: "bob",
					amount: 30,
					currency: "USD",
					confirmedByPayer: true,
					confirmedByPayee: false,
					status: "PROPOSED",
				}),
			});
		});

		it("partial settlement: no warning when amount is less than balance owed", async () => {
			vi.mocked(computeBalance).mockResolvedValue({
				byCurrency: { USD: -100 },
			}); // alice owes bob $100
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			const result = await service.initiateSettlement({
				toParticipant: bob,
				amount: 60,
				currency: "USD",
			});

			// $60 < $100 owed → no warning
			expect(result.warning).toBeNull();
		});

		it("full settlement: no warning when amount exactly equals balance owed", async () => {
			vi.mocked(computeBalance).mockResolvedValue({
				byCurrency: { USD: -100 },
			}); // alice owes bob $100
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			const result = await service.initiateSettlement({
				toParticipant: bob,
				amount: 100,
				currency: "USD",
			});

			// $100 == $100 owed → no warning
			expect(result.warning).toBeNull();
		});

		it("over-settlement: throws when settlement exceeds balance owed", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } }); // alice owes bob $50
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			// $60 > $50 owed → hard block, no settlement recorded
			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 60,
					currency: "USD",
				}),
			).rejects.toThrow(/exceeds the outstanding balance/);
			expect(db.settlement.create).not.toHaveBeenCalled();
		});

		it("settlement on zero balance: throws (bob owes alice, not the other way)", async () => {
			// computeBalance(alice, bob) = +50 means BOB owes ALICE, not alice owes bob.
			// amountOwed = max(0, -50) = 0 → alice owes bob $0
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: 50 } });
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			// alice doesn't owe bob anything, but is trying to settle → block
			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 30,
					currency: "USD",
				}),
			).rejects.toThrow(/exceeds the outstanding balance/);
			expect(db.settlement.create).not.toHaveBeenCalled();
		});

		it("settlement on completely zero balance (no transactions): throws", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} }); // no balance at all
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			// No balance exists → any settlement amount exceeds $0 → block
			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 30,
					currency: "USD",
				}),
			).rejects.toThrow(/exceeds the outstanding balance/);
			expect(db.settlement.create).not.toHaveBeenCalled();
		});

		it("multiple settlements scenario: warning is based on current computed balance", async () => {
			// After two prior settlements, alice still owes $40
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -40 } });
			db.settlement.create.mockResolvedValue({
				id: "s-3",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			const result = await service.initiateSettlement({
				toParticipant: bob,
				amount: 40,
				currency: "USD",
			});

			// $40 == $40 remaining → no warning
			expect(result.warning).toBeNull();
		});

		it("stores currency conversion fields when provided", async () => {
			vi.mocked(computeBalance).mockResolvedValue({
				byCurrency: { ARS: -50000 },
			});
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			await service.initiateSettlement({
				toParticipant: bob,
				amount: 50000,
				currency: "ARS",
				convertedAmount: 50,
				convertedCurrency: "USD",
				exchangeRateUsed: 1000,
			});

			expect(db.settlement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					amount: 50000,
					currency: "ARS",
					convertedAmount: 50,
					convertedCurrency: "USD",
					exchangeRateUsed: 1000,
				}),
			});
		});

		it("rejects when no financial relationship exists", async () => {
			db.sharedTransaction.count.mockResolvedValue(0); // no shared transactions

			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 30,
					currency: "USD",
				}),
			).rejects.toThrow("No financial relationship found");
		});

		it("works with shadow profile participants", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -20 } });
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			const result = await service.initiateSettlement({
				toParticipant: shadow,
				amount: 20,
				currency: "USD",
			});

			expect(result.warning).toBeNull();
			expect(db.settlement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					toParticipantType: "shadow",
					toParticipantId: "shadow-1",
				}),
			});
		});

		it("rejects shadow participant when profile does not exist", async () => {
			db.shadowProfile.findUnique.mockResolvedValue(null); // shadow not found

			await expect(
				service.initiateSettlement({
					toParticipant: shadow,
					amount: 20,
					currency: "USD",
				}),
			).rejects.toThrow("Person not found");
		});
	});

	// ── project-scoped settlements ────────────────────────────────────────────
	//
	// These assert the KEY correctness invariant: the over-payment cap is computed
	// in the SAME scope as the settlement is written, and the row is stamped with
	// the caller's projectId (null for a global/direct entry).

	describe("project-scoped initiateSettlement", () => {
		it("computes the cap in the project scope and stamps projectId on the row", async () => {
			// In project P alice owes bob $50; globally she might owe more/less, but
			// only the scoped balance is consulted.
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			await service.initiateSettlement({
				toParticipant: bob,
				amount: 50,
				currency: "USD",
				projectId: "P",
			});

			// Cap computed with the project scope (same scope as the write).
			expect(computeBalance).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ participantId: "alice" }),
				bob,
				{ projectScope: "P" },
			);
			// Row stamped with the project.
			expect(db.settlement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ projectId: "P" }),
			});
		});

		it("over-payment cap is project-scoped: blocks when amount exceeds the project balance", async () => {
			// alice owes bob only $20 in project P.
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -20 } });
			db.settlement.create.mockResolvedValue({ id: "s-1" });

			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 30,
					currency: "USD",
					projectId: "P",
				}),
			).rejects.toThrow(/exceeds the outstanding balance/);
			expect(db.settlement.create).not.toHaveBeenCalled();
			// The cap was read from the SAME (scoped) balance, not the global one.
			expect(computeBalance).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ participantId: "alice" }),
				bob,
				{ projectScope: "P" },
			);
		});

		it("global entry (no projectId): cap is GLOBAL and the row is stamped projectId=null", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
			db.settlement.create.mockResolvedValue({
				id: "s-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
			});

			await service.initiateSettlement({
				toParticipant: bob,
				amount: 50,
				currency: "USD",
			});

			// projectScope undefined => GLOBAL cap.
			expect(computeBalance).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ participantId: "alice" }),
				bob,
				{ projectScope: undefined },
			);
			// Row stamped null (direct / rollup settlement).
			expect(db.settlement.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ projectId: null }),
			});
		});
	});

	describe("project-scoped settleAll", () => {
		it("stamps projectId on every settlement row and scopes the balance", async () => {
			// alice owes bob in USD within project P. Paying in USD avoids exchange
			// -rate lookups (not needed to prove scoping + stamping).
			vi.mocked(computeBalance).mockResolvedValue({
				byCurrency: { USD: -30 },
			});
			let created = 0;
			db.settlement.create.mockImplementation(
				(args: { data: Record<string, unknown> }) => {
					created += 1;
					return Promise.resolve({
						id: `s-${created}`,
						amount: args.data.amount,
						currency: args.data.currency,
						convertedAmount: args.data.convertedAmount ?? null,
						convertedCurrency: args.data.convertedCurrency ?? null,
						projectId: args.data.projectId ?? null,
					});
				},
			);

			const result = await service.settleAll({
				toParticipant: bob,
				paymentCurrency: "USD",
				projectId: "P",
			});

			// Balance scoped to the project (same scope as the writes).
			expect(computeBalance).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ participantId: "alice" }),
				bob,
				{ projectScope: "P" },
			);

			// At least one row was written and EVERY written row carries projectId=P.
			expect(db.settlement.create).toHaveBeenCalled();
			const createCalls = db.settlement.create.mock.calls as Array<
				[{ data: { projectId?: unknown } }]
			>;
			for (const [callArgs] of createCalls) {
				expect(callArgs.data.projectId).toBe("P");
			}
			expect(result.settlements.length).toBeGreaterThan(0);
		});
	});

	// ── confirmSettlement ─────────────────────────────────────────────────────

	describe("confirmSettlement", () => {
		it("sets status to FINALIZED when payee confirms", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				toParticipantType: "user",
				toParticipantId: "alice", // alice is the payee
				fromParticipantType: "user",
				fromParticipantId: "bob",
				confirmedByPayee: false,
				amount: 50,
				currency: "USD",
			});
			db.settlement.update.mockResolvedValue({
				id: "settle-1",
				status: "FINALIZED",
			});

			await service.confirmSettlement("settle-1");

			expect(db.settlement.update).toHaveBeenCalledWith({
				where: { id: "settle-1" },
				data: {
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: expect.any(Date),
				},
			});
		});

		it("returns the updated settlement record", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				toParticipantType: "user",
				toParticipantId: "alice",
				fromParticipantType: "user",
				fromParticipantId: "bob",
				confirmedByPayee: false,
				amount: 50,
				currency: "USD",
			});
			const finalized = { id: "settle-1", status: "FINALIZED" };
			db.settlement.update.mockResolvedValue(finalized);

			const result = await service.confirmSettlement("settle-1");

			expect(result).toBe(finalized);
		});

		it("rejects when non-payee tries to confirm", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				toParticipantType: "user",
				toParticipantId: "carol", // carol is the payee, not alice
				fromParticipantType: "user",
				fromParticipantId: "bob",
				confirmedByPayee: false,
			});

			await expect(service.confirmSettlement("settle-1")).rejects.toThrow(
				"Only the payee can confirm",
			);
		});

		it("rejects when settlement is already confirmed", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				toParticipantType: "user",
				toParticipantId: "alice",
				fromParticipantType: "user",
				fromParticipantId: "bob",
				confirmedByPayee: true, // already confirmed
			});

			await expect(service.confirmSettlement("settle-1")).rejects.toThrow(
				"already confirmed",
			);
		});

		it("rejects when settlement not found", async () => {
			db.settlement.findUnique.mockResolvedValue(null);

			await expect(service.confirmSettlement("nonexistent")).rejects.toThrow(
				"Settlement not found",
			);
		});
	});

	// ── deletePendingSettlement ───────────────────────────────────────────────

	describe("deletePendingSettlement", () => {
		it("payer can delete an unconfirmed (PROPOSED) settlement", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				fromParticipantType: "user",
				fromParticipantId: "alice", // alice is the payer
				toParticipantType: "user",
				toParticipantId: "bob",
				amount: 30,
				currency: "USD",
				status: "PROPOSED",
				initiatedAt: new Date("2026-03-01"),
				confirmedByPayee: false,
			});
			db.settlement.delete.mockResolvedValue({ id: "settle-1" });

			const result = await service.deletePendingSettlement("settle-1");

			expect(db.settlement.delete).toHaveBeenCalledWith({
				where: { id: "settle-1" },
			});
			expect(result).toEqual({ success: true });
		});

		it("rejects when non-payer tries to delete", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				fromParticipantType: "user",
				fromParticipantId: "bob", // bob is the payer, not alice
				confirmedByPayee: false,
			});

			await expect(service.deletePendingSettlement("settle-1")).rejects.toThrow(
				"Only the payer can delete",
			);
		});

		it("rejects deletion of a confirmed settlement", async () => {
			db.settlement.findUnique.mockResolvedValue({
				id: "settle-1",
				fromParticipantType: "user",
				fromParticipantId: "alice",
				confirmedByPayee: true, // already confirmed by payee
			});

			await expect(service.deletePendingSettlement("settle-1")).rejects.toThrow(
				"Cannot delete a confirmed settlement",
			);
		});

		it("rejects when settlement not found", async () => {
			db.settlement.findUnique.mockResolvedValue(null);

			await expect(
				service.deletePendingSettlement("nonexistent"),
			).rejects.toThrow("Settlement not found");
		});
	});

	// ── getSettlementPlan ─────────────────────────────────────────────────────

	describe("getSettlementPlan", () => {
		it("returns per-currency balances with correct directions", async () => {
			// USD: bob owes alice $50 (positive balance = they_owe_you)
			// ARS: alice owes bob $5000 (negative balance = you_owe_them)
			vi.mocked(computeBalance).mockResolvedValue({
				byCurrency: { USD: 50, ARS: -5000 },
			});

			const result = await service.getSettlementPlan(bob);

			expect(result).toHaveLength(2);

			const usd = result.find((r) => r.currency === "USD")!;
			expect(usd.balance).toBe(50);
			expect(usd.direction).toBe("they_owe_you");
			expect(usd.suggestedAmount).toBe(50);

			const ars = result.find((r) => r.currency === "ARS")!;
			expect(ars.balance).toBe(5000); // absolute value
			expect(ars.direction).toBe("you_owe_them");
			expect(ars.suggestedAmount).toBe(5000);
		});

		it("returns empty array when balance is fully settled", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: {} });

			const result = await service.getSettlementPlan(bob);

			expect(result).toHaveLength(0);
		});

		it("suggestedAmount is always absolute value of balance", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -75 } });

			const [plan] = await service.getSettlementPlan(bob);

			expect(plan!.balance).toBe(75); // absolute
			expect(plan!.suggestedAmount).toBe(75);
			expect(plan!.direction).toBe("you_owe_them");
		});

		it("rejects when no financial relationship", async () => {
			db.sharedTransaction.count.mockResolvedValue(0);

			await expect(service.getSettlementPlan(bob)).rejects.toThrow(
				"No financial relationship found",
			);
		});
	});

	// ── getSettlementHistory ──────────────────────────────────────────────────

	describe("getSettlementHistory", () => {
		it("returns settlements ordered by initiatedAt descending with direction", async () => {
			const now = new Date("2026-03-05");
			const earlier = new Date("2026-03-01");

			db.settlement.findMany.mockResolvedValue([
				{
					id: "s-1",
					amount: 50,
					currency: "USD",
					fromParticipantId: "alice", // outgoing: alice paid
					toParticipantId: "bob",
					confirmedByPayee: true,
					initiatedAt: now,
					settledAt: now,
					convertedAmount: null,
					convertedCurrency: null,
					exchangeRateUsed: null,
					paymentMethod: null,
					note: null,
				},
				{
					id: "s-2",
					amount: 30,
					currency: "USD",
					fromParticipantId: "bob", // incoming: bob paid alice
					toParticipantId: "alice",
					confirmedByPayee: false,
					initiatedAt: earlier,
					settledAt: null,
					convertedAmount: null,
					convertedCurrency: null,
					exchangeRateUsed: null,
					paymentMethod: null,
					note: null,
				},
			]);

			const result = await service.getSettlementHistory(bob);

			expect(result).toHaveLength(2);

			expect(result[0]!.id).toBe("s-1");
			expect(result[0]!.direction).toBe("outgoing");
			expect(result[0]!.status).toBe("confirmed");
			expect(result[0]!.amount).toBe(50);

			expect(result[1]!.id).toBe("s-2");
			expect(result[1]!.direction).toBe("incoming");
			expect(result[1]!.status).toBe("pending_payee_confirmation");
		});

		it("serializes Decimal amounts to numbers", async () => {
			db.settlement.findMany.mockResolvedValue([
				{
					id: "s-1",
					amount: { toNumber: () => 75, toString: () => "75" }, // Prisma Decimal mock
					currency: "USD",
					fromParticipantId: "alice",
					toParticipantId: "bob",
					confirmedByPayee: false,
					initiatedAt: new Date(),
					settledAt: null,
					convertedAmount: null,
					convertedCurrency: null,
					exchangeRateUsed: null,
					paymentMethod: null,
					note: null,
				},
			]);

			const result = await service.getSettlementHistory(bob);

			expect(typeof result[0]!.amount).toBe("number");
			expect(result[0]!.amount).toBe(75);
		});

		it("rejects when no financial relationship", async () => {
			db.sharedTransaction.count.mockResolvedValue(0);

			await expect(service.getSettlementHistory(bob)).rejects.toThrow(
				"No financial relationship found",
			);
		});
	});
});
