import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotification } from "~/server/services/notifications";
import { computeBalance, computeBalanceByProject } from "./balance";
import {
	RECORDED_BY_PAYEE_REASON,
	SettlementService,
} from "./settlement.service";

// Mock the notifications module: it uses the global DB and cannot run in unit tests.
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

// Exchange rates for settleAll conversions: 3 EUR and 151 JPY per USD,
// 60000 USD per BTC.
const TEST_RATES: Record<string, number> = { EUR: 3, JPY: 151, BTC: 60000 };
vi.mock("~/server/api/routers/shared-currency", () => ({
	getBestExchangeRate: vi.fn(async (_db: unknown, currency: string) =>
		TEST_RATES[currency] ? { rate: TEST_RATES[currency] } : null,
	),
}));

// Mock computeBalance so settlement service tests control the balance independently
// of the balance module's own correctness (tested separately in balance.test.ts).
vi.mock("./balance", () => ({
	computeBalance: vi.fn(),
	computeBalanceByProject: vi.fn(),
}));

// ── mock factory ───────────────────────────────────────────────────────────────

function createMockDb() {
	const iface = {
		// pg_advisory_xact_lock for the settlement pair lock.
		$executeRaw: vi.fn().mockResolvedValue(1),
		settlement: {
			create: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn().mockResolvedValue([]),
			// Group writes; one row per group unless a test says otherwise.
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		sharedTransaction: {
			// Relationship exists by default. Project "OTHER" has no expenses
			// involving the caller (see the projectParticipant mock below).
			count: vi.fn((args?: { where?: { projectId?: string } }) =>
				Promise.resolve(args?.where?.projectId === "OTHER" ? 0 : 1),
			),
		},
		shadowProfile: {
			findUnique: vi.fn().mockResolvedValue({ id: "shadow-1" }),
		},
		// Project "P" has alice, bob and the shadow as participants.
		projectParticipant: {
			findMany: vi.fn(
				(args: {
					where: {
						projectId: string;
						OR: Array<{ participantType: string; participantId: string }>;
					};
				}) =>
					Promise.resolve(
						args.where.projectId === "P"
							? args.where.OR.filter((r) =>
									["alice", "bob", "shadow-1"].includes(r.participantId),
								)
							: [],
					),
			),
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
		// By default every debt sits in the direct (project-less) bucket, so the
		// global allocation mirrors whatever computeBalance is mocked to return.
		vi.mocked(computeBalanceByProject).mockImplementation(async (...args) => {
			const { byCurrency } = await vi.mocked(computeBalance)(...args);
			return new Map([[null, byCurrency]]);
		});
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

		it("global entry splits the payment into one row per scope, smallest debt first", async () => {
			// Globally alice owes bob $50: $30 in project P and $20 directly.
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
			vi.mocked(computeBalanceByProject).mockResolvedValue(
				new Map<string | null, Record<string, number>>([
					["P", { USD: -30 }],
					[null, { USD: -20 }],
				]),
			);
			db.settlement.create.mockImplementation(
				(args: { data: Record<string, unknown> }) =>
					Promise.resolve({ id: `s-${String(args.data.projectId)}` }),
			);

			const result = await service.initiateSettlement({
				toParticipant: bob,
				amount: 50,
				currency: "USD",
			});

			const rows = (
				db.settlement.create.mock.calls as Array<
					[{ data: { projectId: unknown; amount: unknown } }]
				>
			).map(([a]) => ({ projectId: a.data.projectId, amount: a.data.amount }));
			expect(rows).toEqual([
				{ projectId: null, amount: 20 },
				{ projectId: "P", amount: 30 },
			]);
			expect(result.settlements).toHaveLength(2);
		});

		it("rejects a project the caller has no part in", async () => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
			await expect(
				service.initiateSettlement({
					toParticipant: bob,
					amount: 10,
					currency: "USD",
					projectId: "OTHER",
				}),
			).rejects.toThrow(/not part of this project/);
			expect(db.settlement.create).not.toHaveBeenCalled();
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

	describe("global settleAll", () => {
		it("splits a converted payment across scopes with rows summing to the converted total", async () => {
			// alice owes bob EUR 1 in each of three scopes (EUR 3 globally).
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { EUR: -3 } });
			vi.mocked(computeBalanceByProject).mockResolvedValue(
				new Map<string | null, Record<string, number>>([
					[null, { EUR: -1 }],
					["P", { EUR: -1 }],
					["Q", { EUR: -1 }],
				]),
			);
			db.settlement.create.mockImplementation(
				(args: { data: Record<string, unknown> }) =>
					Promise.resolve({ id: "s", ...args.data }),
			);

			const result = await service.settleAll({
				toParticipant: bob,
				paymentCurrency: "USD",
			});

			// EUR 1 = USD 0.333...: two rows round to 0.33 and the last row takes
			// the remainder so the rows add up to USD 1.00 (the converted EUR 3).
			expect(result.settlements.map((r) => r.convertedAmount)).toEqual([
				0.33, 0.33, 0.34,
			]);
			expect(result.totalInPaymentCurrency).toBe(1);
			expect(result.settlements.map((r) => r.projectId)).toEqual([
				null,
				"P",
				"Q",
			]);
		});

		it.each([
			// EUR 1 = USD 0.3333: 50.33 JPY rounds to whole yen, BTC keeps 8 decimals
			["JPY", 50],
			["BTC", 0.00000556],
		])("converts into %s with that currency's decimals", async (currency, expected) => {
			vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { EUR: -1 } });
			vi.mocked(computeBalanceByProject).mockResolvedValue(
				new Map<string | null, Record<string, number>>([[null, { EUR: -1 }]]),
			);
			db.settlement.create.mockImplementation(
				(args: { data: Record<string, unknown> }) =>
					Promise.resolve({ id: "s", ...args.data }),
			);

			const result = await service.settleAll({
				toParticipant: bob,
				paymentCurrency: currency,
			});

			expect(result.settlements.map((r) => r.convertedAmount)).toEqual([
				expected,
			]);
			expect(result.totalInPaymentCurrency).toBe(expected);
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
		const pendingFromBob = {
			id: "settle-1",
			toParticipantType: "user",
			toParticipantId: "alice", // alice is the payee
			fromParticipantType: "user",
			fromParticipantId: "bob",
			status: "PROPOSED",
			confirmedByPayer: true,
			confirmedByPayee: false,
			amount: 50,
			currency: "USD",
			projectId: null,
			paymentGroupId: null,
			isOffset: false,
		};

		it("sets status to FINALIZED when payee confirms", async () => {
			db.settlement.findUnique.mockResolvedValue(pendingFromBob);

			await service.confirmSettlement("settle-1");

			expect(db.settlement.updateMany).toHaveBeenCalledWith({
				where: { id: { in: ["settle-1"] }, status: { in: ["PROPOSED"] } },
				data: {
					confirmedByPayer: true,
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: expect.any(Date),
				},
			});
		});

		it("returns the updated settlement record", async () => {
			db.settlement.findUnique.mockResolvedValue(pendingFromBob);

			const result = await service.confirmSettlement("settle-1");

			expect(result).toMatchObject({ id: "settle-1", status: "FINALIZED" });
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
				...pendingFromBob,
				status: "FINALIZED",
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
		const pendingFromAlice = {
			id: "settle-1",
			fromParticipantType: "user",
			fromParticipantId: "alice", // alice is the payer
			toParticipantType: "user",
			toParticipantId: "bob",
			amount: 30,
			currency: "USD",
			status: "PROPOSED",
			initiatedAt: new Date("2026-03-01"),
			confirmedByPayer: true,
			confirmedByPayee: false,
			projectId: null,
			paymentGroupId: null,
			isOffset: false,
		};

		it("payer can delete an unconfirmed (PROPOSED) settlement", async () => {
			db.settlement.findUnique.mockResolvedValue(pendingFromAlice);

			const result = await service.deletePendingSettlement("settle-1");

			expect(db.settlement.deleteMany).toHaveBeenCalledWith({
				where: {
					id: { in: ["settle-1"] },
					status: { in: ["PROPOSED", "REJECTED"] },
				},
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
				...pendingFromAlice,
				status: "FINALIZED",
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
					fromParticipantType: "user",
					fromParticipantId: "alice", // outgoing: alice paid
					toParticipantType: "user",
					toParticipantId: "bob",
					status: "FINALIZED",
					confirmedByPayer: true,
					confirmedByPayee: true,
					reminderCount: 0,
					reminderSentAt: null,
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
					fromParticipantType: "user",
					fromParticipantId: "bob", // incoming: bob paid alice
					toParticipantType: "user",
					toParticipantId: "alice",
					status: "PROPOSED",
					confirmedByPayer: true,
					confirmedByPayee: false,
					reminderCount: 0,
					reminderSentAt: null,
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
					fromParticipantType: "user",
					fromParticipantId: "alice",
					toParticipantType: "user",
					toParticipantId: "bob",
					status: "PROPOSED",
					confirmedByPayer: true,
					confirmedByPayee: false,
					reminderCount: 0,
					reminderSentAt: null,
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

// ── concurrency: the over-payment cap must hold under concurrent payments ──────

describe("SettlementService pair lock", () => {
	/**
	 * A db whose $transaction behaves like Postgres with an advisory lock: a
	 * transaction that calls $executeRaw (the pair lock) waits for the previous
	 * holder's transaction to finish. The balance is derived from the rows
	 * created so far, so a second payment only sees the first one if it waited.
	 */
	function createLockingDb(owed: number) {
		const created: Array<{ amount: number }> = [];
		let lockChain: Promise<void> = Promise.resolve();
		const base = createMockDb();
		base.settlement.create.mockImplementation(
			async (args: { data: { amount: number } }) => {
				// Yield so a concurrent transaction gets a chance to interleave.
				await new Promise((r) => setTimeout(r, 0));
				created.push({ amount: args.data.amount });
				return { id: `s-${created.length}`, ...args.data };
			},
		);
		vi.mocked(computeBalance).mockImplementation(async () => ({
			byCurrency: {
				USD: -(owed - created.reduce((sum, c) => sum + c.amount, 0)),
			},
		}));
		const db = {
			...base,
			$transaction: vi.fn(
				async <T>(cb: (tx: typeof base) => Promise<T>): Promise<T> => {
					let release: () => void = () => {};
					const tx = {
						...base,
						$executeRaw: vi.fn(async () => {
							const previous = lockChain;
							lockChain = new Promise<void>((r) => {
								release = r;
							});
							await previous;
							return 1;
						}),
					};
					try {
						return await cb(tx);
					} finally {
						release();
					}
				},
			),
		};
		return { db, created };
	}

	beforeEach(() => {
		vi.mocked(computeBalanceByProject).mockImplementation(async (...args) => {
			const { byCurrency } = await vi.mocked(computeBalance)(...args);
			return new Map([[null, byCurrency]]);
		});
	});

	it("lets only one of two concurrent full payments through", async () => {
		const { db, created } = createLockingDb(50);
		const service = new SettlementService(db as never, "alice");
		const pay = () =>
			service.initiateSettlement({
				toParticipant: bob,
				amount: 50,
				currency: "USD",
				projectId: "P",
			});

		const results = await Promise.allSettled([pay(), pay()]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(created).toEqual([{ amount: 50 }]);
	});

	it("serializes concurrent settle-all calls the same way", async () => {
		const { db, created } = createLockingDb(50);
		const service = new SettlementService(db as never, "alice");
		const settle = () =>
			service.settleAll({
				toParticipant: bob,
				paymentCurrency: "USD",
				projectId: "P",
			});

		const results = await Promise.allSettled([settle(), settle()]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(created).toEqual([{ amount: 50 }]);
	});

	it("takes the lock before reading the balance, keyed on the unordered pair", async () => {
		const db = createMockDb();
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -10 } });
		db.settlement.create.mockResolvedValue({ id: "s-1" });

		await new SettlementService(db as never, "alice").initiateSettlement({
			toParticipant: bob,
			amount: 10,
			currency: "USD",
			projectId: "P",
		});

		const lockOrder = db.$executeRaw.mock.invocationCallOrder[0]!;
		const readOrder = vi.mocked(computeBalance).mock.invocationCallOrder.at(-1)!;
		expect(lockOrder).toBeLessThan(readOrder);
		const call = db.$executeRaw.mock.calls[0] as unknown as [
			TemplateStringsArray,
			string,
		];
		expect(call[0].join("?")).toContain("pg_advisory_xact_lock");
		// Same key whichever side of the pair is the caller.
		expect(call[1]).toBe("user:alice|user:bob");
	});
});

// ── recording a payment received ("they paid me") ──────────────────────────────

describe("SettlementService incoming payments", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: SettlementService;

	beforeEach(() => {
		db = createMockDb();
		service = new SettlementService(db as never, "alice");
		vi.mocked(createNotification).mockClear();
		vi.mocked(computeBalanceByProject).mockImplementation(async (...args) => {
			const { byCurrency } = await vi.mocked(computeBalance)(...args);
			return new Map([[null, byCurrency]]);
		});
	});

	it("records bob as payer and alice as payee, final at once", async () => {
		// From the payer's (bob's) side: bob owes alice $50.
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
		db.settlement.create.mockImplementation(
			async (args: { data: Record<string, unknown> }) => ({
				id: "s-in",
				...args.data,
			}),
		);

		const result = await service.initiateSettlement({
			toParticipant: bob,
			direction: "incoming",
			amount: 50,
			currency: "USD",
			projectId: "P",
		});

		// Cap read from the payer's side.
		expect(computeBalance).toHaveBeenLastCalledWith(
			expect.anything(),
			bob,
			expect.objectContaining({ participantId: "alice" }),
			{ projectScope: "P" },
		);
		expect(db.settlement.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				fromParticipantType: "user",
				fromParticipantId: "bob",
				toParticipantType: "user",
				toParticipantId: "alice",
				amount: 50,
				status: "FINALIZED",
				confirmedByPayer: false,
				confirmedByPayee: true,
				autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
			}),
		});
		expect(result.requiresPayeeConfirmation).toBe(false);
		// Bob hears that alice recorded his payment.
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "bob",
				type: "SETTLEMENT_CONFIRMED",
			}),
		);
	});

	it("caps at what the other person owes you", async () => {
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -20 } });

		await expect(
			service.initiateSettlement({
				toParticipant: bob,
				direction: "incoming",
				amount: 30,
				currency: "USD",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);
		expect(db.settlement.create).not.toHaveBeenCalled();
	});

	it("refuses when they do not owe you anything", async () => {
		// From bob's side: alice owes bob, so bob owes alice nothing.
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: 40 } });

		await expect(
			service.initiateSettlement({
				toParticipant: bob,
				direction: "incoming",
				amount: 10,
				currency: "USD",
			}),
		).rejects.toThrow(/exceeds the outstanding balance/);
		expect(db.settlement.create).not.toHaveBeenCalled();
	});

	it("still requires confirmation for an outgoing payment to a user", async () => {
		vi.mocked(computeBalance).mockResolvedValue({ byCurrency: { USD: -50 } });
		db.settlement.create.mockImplementation(
			async (args: { data: Record<string, unknown> }) => ({
				id: "s-out",
				...args.data,
			}),
		);

		const result = await service.initiateSettlement({
			toParticipant: bob,
			direction: "outgoing",
			amount: 50,
			currency: "USD",
		});

		expect(result.requiresPayeeConfirmation).toBe(true);
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "bob", type: "SETTLEMENT_RECEIVED" }),
		);
	});

	it("settleAll records everything they owe you as received", async () => {
		vi.mocked(computeBalance).mockResolvedValue({
			byCurrency: { USD: -30, EUR: 5 },
		});
		db.settlement.create.mockImplementation(
			async (args: { data: Record<string, unknown> }) => ({
				id: "s-all",
				...args.data,
			}),
		);

		const result = await service.settleAll({
			toParticipant: bob,
			direction: "incoming",
			paymentCurrency: "USD",
			projectId: "P",
		});

		// Only USD: in EUR it is alice who owes bob.
		expect(db.settlement.create).toHaveBeenCalledTimes(1);
		expect(db.settlement.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				fromParticipantId: "bob",
				toParticipantId: "alice",
				amount: 30,
				currency: "USD",
				status: "FINALIZED",
			}),
		});
		expect(result.requiresPayeeConfirmation).toBe(false);
	});

	it("lets the payee void a payment they recorded, but not one bob sent", async () => {
		const recorded = {
			id: "s-in",
			fromParticipantType: "user",
			fromParticipantId: "bob",
			toParticipantType: "user",
			toParticipantId: "alice",
			amount: 50,
			currency: "USD",
			status: "FINALIZED",
			confirmedByPayer: false,
			confirmedByPayee: true,
			autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
			initiatedAt: new Date(),
			projectId: null,
		};
		db.settlement.findUnique.mockResolvedValueOnce(recorded);
		await expect(service.voidAutoFinalizedSettlement("s-in")).resolves.toEqual({
			success: true,
		});
		expect(db.settlement.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["s-in"] }, status: { in: ["FINALIZED"] } },
		});

		// A payment bob sent and alice confirmed is not alice's to undo.
		db.settlement.deleteMany.mockClear();
		db.settlement.findUnique.mockResolvedValueOnce({
			...recorded,
			id: "s-sent",
			confirmedByPayer: true,
			autoConfirmedReason: null,
		});
		await expect(service.voidAutoFinalizedSettlement("s-sent")).rejects.toThrow(
			"Cannot void a settlement to a registered user",
		);
		expect(db.settlement.deleteMany).not.toHaveBeenCalled();
	});

	it("history marks a payment you recorded as received voidable", async () => {
		db.settlement.findMany.mockResolvedValueOnce([
			{
				id: "s-in",
				fromParticipantType: "user",
				fromParticipantId: "bob",
				toParticipantType: "user",
				toParticipantId: "alice",
				amount: 50,
				currency: "USD",
				status: "FINALIZED",
				confirmedByPayer: false,
				confirmedByPayee: true,
				autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
				reminderCount: 0,
				reminderSentAt: null,
				initiatedAt: new Date(),
			},
		]);

		const [row] = await service.getSettlementHistory(bob);

		expect(row).toMatchObject({
			direction: "incoming",
			status: "confirmed",
			canVoid: true,
			canConfirm: false,
		});
	});
});
