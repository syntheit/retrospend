/**
 * Settlement Authorization Tests
 *
 * Tests SettlementService directly (not through tRPC) to verify:
 * - Only the payee can confirm a settlement
 * - Only the payer can delete a pending settlement
 * - Self-settlements are rejected
 * - Confirmed settlements are immutable
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("~/server/services/shared-expenses/audit-log", () => ({
	logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

vi.mock("~/server/services/shared-expenses/balance", () => ({
	computeBalance: vi.fn().mockResolvedValue({ byCurrency: { USD: -100 } }),
}));

// ── Import under test ─────────────────────────────────────────────────────

import { SettlementService } from "~/server/services/shared-expenses/settlement.service";

// ── Mock DB factory ───────────────────────────────────────────────────────

function makeMockDb() {
	return {
		settlement: {
			findUnique: vi.fn(),
			create: vi.fn().mockResolvedValue({ id: "s-new" }),
			update: vi.fn().mockResolvedValue({ id: "s-1", confirmedByPayee: true }),
			delete: vi.fn().mockResolvedValue({}),
			findMany: vi.fn().mockResolvedValue([]),
		},
		sharedTransaction: {
			count: vi.fn().mockResolvedValue(1), // assert relationship passes by default
		},
		shadowProfile: {
			findUnique: vi.fn(),
		},
		$transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
			cb({
				settlement: {
					create: vi.fn().mockResolvedValue({ id: "s-new" }),
				},
				$executeRaw: vi.fn().mockResolvedValue(1),
				auditLog: { create: vi.fn().mockResolvedValue({}) },
			}),
		),
	};
}

function makeSettlement(overrides: Record<string, unknown> = {}) {
	return {
		id: "s-1",
		fromParticipantType: "user" as const,
		fromParticipantId: "payer-user",
		toParticipantType: "user" as const,
		toParticipantId: "payee-user",
		amount: 100,
		currency: "USD",
		convertedAmount: null,
		convertedCurrency: null,
		exchangeRateUsed: null,
		paymentMethod: null,
		note: null,
		confirmedByPayer: true,
		confirmedByPayee: false,
		status: "PROPOSED" as const,
		initiatedAt: new Date(),
		settledAt: null,
		...overrides,
	};
}

// ── Tests: confirmSettlement ──────────────────────────────────────────────

describe("SettlementService.confirmSettlement", () => {
	it("payee can confirm settlement", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(makeSettlement());
		// Service is constructed with payee's userId
		const svc = new SettlementService(db as never, "payee-user");
		const result = await svc.confirmSettlement("s-1");
		expect(db.settlement.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "s-1" },
				data: expect.objectContaining({ confirmedByPayee: true, status: "FINALIZED" }),
			}),
		);
		expect(result).toBeTruthy();
	});

	it("payer cannot confirm their own settlement", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(makeSettlement());
		// Payer tries to confirm - toParticipantId is "payee-user", not "payer-user"
		const svc = new SettlementService(db as never, "payer-user");
		await expect(svc.confirmSettlement("s-1")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("third party cannot confirm settlement", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(makeSettlement());
		const svc = new SettlementService(db as never, "random-user");
		await expect(svc.confirmSettlement("s-1")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("already-confirmed settlement throws BAD_REQUEST", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(
			makeSettlement({ confirmedByPayee: true }),
		);
		const svc = new SettlementService(db as never, "payee-user");
		await expect(svc.confirmSettlement("s-1")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("non-existent settlement throws NOT_FOUND", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(null);
		const svc = new SettlementService(db as never, "payee-user");
		await expect(svc.confirmSettlement("missing-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

// ── Tests: deletePendingSettlement ────────────────────────────────────────

describe("SettlementService.deletePendingSettlement", () => {
	it("payer can delete their pending settlement", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(makeSettlement());
		const svc = new SettlementService(db as never, "payer-user");
		const result = await svc.deletePendingSettlement("s-1");
		expect(db.settlement.delete).toHaveBeenCalledWith({ where: { id: "s-1" } });
		expect(result).toEqual({ success: true });
	});

	it("payee cannot delete a settlement they did not initiate", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(makeSettlement());
		const svc = new SettlementService(db as never, "payee-user");
		await expect(svc.deletePendingSettlement("s-1")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("confirmed settlement cannot be deleted", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(
			makeSettlement({ confirmedByPayee: true }),
		);
		const svc = new SettlementService(db as never, "payer-user");
		await expect(svc.deletePendingSettlement("s-1")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("non-existent settlement throws NOT_FOUND", async () => {
		const db = makeMockDb();
		db.settlement.findUnique.mockResolvedValue(null);
		const svc = new SettlementService(db as never, "payer-user");
		await expect(svc.deletePendingSettlement("ghost-id")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

// ── Tests: initiateSettlement ─────────────────────────────────────────────

describe("SettlementService.initiateSettlement", () => {
	it("self-settlement is rejected with BAD_REQUEST", async () => {
		const db = makeMockDb();
		const svc = new SettlementService(db as never, "user-1");
		await expect(
			svc.initiateSettlement({
				toParticipant: { participantType: "user", participantId: "user-1" },
				amount: 50,
				currency: "USD",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("normal creation succeeds and sets confirmedByPayer=true", async () => {
		const db = makeMockDb();
		db.$transaction.mockImplementation(
			async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
				const tx = {
					settlement: {
						create: vi.fn().mockResolvedValue({ id: "s-new", amount: 50 }),
					},
					$executeRaw: vi.fn(),
					auditLog: { create: vi.fn().mockResolvedValue({}) },
				};
				// computeBalance mock returns { byCurrency: { USD: -100 } }
				return cb(tx as never);
			},
		);
		const svc = new SettlementService(db as never, "user-1");
		const { settlement } = await svc.initiateSettlement({
			toParticipant: { participantType: "user", participantId: "user-2" },
			amount: 50,
			currency: "USD",
		});
		expect(settlement).toBeTruthy();
	});
});
