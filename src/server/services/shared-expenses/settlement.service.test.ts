/**
 * SettlementService entry points on the stateful in-memory DB, through the
 * real balance code and the payments engine (allocatePayment, payment.record,
 * payment.confirm). Group behavior (confirm, reject, remind, void, offsets)
 * is in settlement-groups.integration.test.ts; real Postgres in
 * services/payments/payments.pg.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import { createNotification } from "~/server/services/notifications";
import {
	RECORDED_BY_PAYEE_REASON,
	SettlementService,
} from "./settlement.service";
import {
	addProject,
	addProjectParticipant,
	addShadowProfile,
	createStatefulDb,
	makeUserRef,
} from "./test-utils";
import type { ParticipantRef } from "./types";

const ALICE = "alice";
const aliceRef = makeUserRef(ALICE);
const bobRef = makeUserRef("bob");

let db: ReturnType<typeof createStatefulDb>;
let ghostRef: ParticipantRef;
let project: string;

/** `creditor` paid an expense of which `debtor` owes `amount`, dated `date`. */
function seedDebt(
	debtor: ParticipantRef,
	creditor: ParticipantRef,
	amount: number,
	opts: { currency?: string; projectId?: string | null; date?: string } = {},
) {
	const txId = `tx-${db._stores.transactions.size + 1}`;
	db._stores.transactions.set(txId, {
		id: txId,
		description: "Shared expense",
		amount,
		currency: opts.currency ?? "USD",
		date: new Date(opts.date ?? "2026-03-10"),
		paidByType: creditor.participantType,
		paidById: creditor.participantId,
		createdByType: creditor.participantType,
		createdById: creditor.participantId,
		splitMode: "EXACT",
		projectId: opts.projectId ?? null,
		billingPeriodId: null,
		isLocked: false,
		notes: null,
		receiptUrl: null,
		categoryId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	for (const [ref, share] of [
		[debtor, amount],
		[creditor, 0],
	] as const) {
		const spId = `sp-${db._stores.splits.size + 1}`;
		db._stores.splits.set(spId, {
			id: spId,
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

const rows = () => [...db._stores.settlements.values()];
const headers = () => [...db._stores.payments.values()];
const alice = () => new SettlementService(db as never, ALICE);

beforeEach(() => {
	vi.mocked(createNotification).mockClear();
	db = createStatefulDb();
	ghostRef = {
		participantType: "shadow",
		participantId: addShadowProfile(db, { createdById: ALICE, name: "Ghost" }).id,
	};
	project = addProject(db, { createdById: ALICE, name: "Trip" }).id;
	for (const ref of [aliceRef, bobRef]) {
		addProjectParticipant(db, { projectId: project, ...ref, role: "EDITOR" });
	}
});

describe("initiateSettlement", () => {
	it("writes a pending payment header and its row with the payer's flags", async () => {
		seedDebt(aliceRef, bobRef, 50);

		const result = await alice().initiateSettlement({
			toParticipant: bobRef,
			amount: 30,
			currency: "USD",
			paymentMethod: "Cash",
		});

		expect(result.requiresPayeeConfirmation).toBe(true);
		expect(result.settlement).toMatchObject({
			fromParticipantId: ALICE,
			toParticipantId: "bob",
			currency: "USD",
			status: "PROPOSED",
			confirmedByPayer: true,
			confirmedByPayee: false,
			paymentGroupId: headers()[0]?.id,
		});
		expect(Number(result.settlement.amount)).toBe(30);
		expect(headers()).toEqual([
			expect.objectContaining({
				payerId: ALICE,
				payeeId: "bob",
				amount: "30",
				currency: "USD",
				paymentMethod: "Cash",
				recordedById: ALICE,
				status: "PROPOSED",
			}),
		]);
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "bob", type: "SETTLEMENT_RECEIVED" }),
		);
	});

	it("refuses more than is owed in that currency, and nothing owed", async () => {
		seedDebt(aliceRef, bobRef, 50);
		await expect(
			alice().initiateSettlement({ toParticipant: bobRef, amount: 60, currency: "USD" }),
		).rejects.toThrow(
			"This settlement of USD 60.00 exceeds the outstanding balance of USD 50.00 with this person.",
		);
		await expect(
			alice().initiateSettlement({ toParticipant: bobRef, amount: 5, currency: "EUR" }),
		).rejects.toThrow("There is no outstanding EUR balance to settle with this person.");
		expect(rows()).toEqual([]);
		expect(headers()).toEqual([]);
	});

	it("pays only the named currency, even when another is owed too", async () => {
		seedDebt(aliceRef, bobRef, 10);
		seedDebt(aliceRef, bobRef, 30, { currency: "EUR" });
		await expect(
			alice().initiateSettlement({ toParticipant: bobRef, amount: 15, currency: "USD" }),
		).rejects.toThrow(/exceeds the outstanding balance of USD 10.00/);
	});

	it("splits a global payment by oldest debt first", async () => {
		seedDebt(aliceRef, bobRef, 5, { date: "2026-03-09" });
		seedDebt(aliceRef, bobRef, 30, { projectId: project, date: "2026-03-01" });

		await alice().initiateSettlement({ toParticipant: bobRef, amount: 32, currency: "USD" });

		expect(rows().map((r) => [r.projectId, Number(r.amount)])).toEqual([
			[project, 30],
			[null, 2],
		]);
		expect(new Set(rows().map((r) => r.paymentGroupId)).size).toBe(1);
	});

	it("is final at once with a shadow, who can never confirm", async () => {
		seedDebt(aliceRef, ghostRef, 20);
		const result = await alice().initiateSettlement({
			toParticipant: ghostRef,
			amount: 20,
			currency: "USD",
		});
		expect(result.requiresPayeeConfirmation).toBe(false);
		expect(headers()[0]?.status).toBe("FINALIZED");
	});

	it("rejects an unknown shadow, no relationship, and a project the caller is not in", async () => {
		await expect(
			alice().initiateSettlement({
				toParticipant: { participantType: "shadow", participantId: "nope" },
				amount: 1,
				currency: "USD",
			}),
		).rejects.toThrow("Person not found");
		await expect(
			alice().initiateSettlement({ toParticipant: bobRef, amount: 1, currency: "USD" }),
		).rejects.toThrow("No financial relationship found");
		seedDebt(aliceRef, bobRef, 5);
		await expect(
			alice().initiateSettlement({
				toParticipant: bobRef,
				amount: 1,
				currency: "USD",
				projectId: "elsewhere",
			}),
		).rejects.toThrow("You are not part of this project");
	});

	it("takes the pair lock before it reads the balance, keyed on the unordered pair", async () => {
		seedDebt(aliceRef, bobRef, 10);
		await alice().initiateSettlement({ toParticipant: bobRef, amount: 10, currency: "USD" });

		const lockOrder = db.$executeRaw.mock.invocationCallOrder[0] ?? 0;
		const readOrder = db.settlement.findMany.mock.invocationCallOrder[0] ?? 0;
		expect(lockOrder).toBeGreaterThan(0);
		expect(lockOrder).toBeLessThan(readOrder);
		const call = db.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
		expect(call[0].join("?")).toContain("pg_advisory_xact_lock");
		expect(call[1]).toBe("user:alice|user:bob");
	});
});

describe("incoming payments (they paid me)", () => {
	it("records bob as payer, final at once, and tells bob", async () => {
		seedDebt(bobRef, aliceRef, 50, { projectId: project });

		const result = await alice().initiateSettlement({
			toParticipant: bobRef,
			direction: "incoming",
			amount: 50,
			currency: "USD",
			projectId: project,
		});

		expect(result.requiresPayeeConfirmation).toBe(false);
		expect(result.settlement).toMatchObject({
			fromParticipantId: "bob",
			toParticipantId: ALICE,
			status: "FINALIZED",
			confirmedByPayer: false,
			confirmedByPayee: true,
			autoConfirmedReason: RECORDED_BY_PAYEE_REASON,
		});
		expect(headers()[0]).toMatchObject({ payerId: "bob", recordedById: ALICE });
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "bob", type: "SETTLEMENT_CONFIRMED" }),
		);
	});

	it("refuses when they owe you nothing", async () => {
		seedDebt(aliceRef, bobRef, 40);
		await expect(
			alice().initiateSettlement({
				toParticipant: bobRef,
				direction: "incoming",
				amount: 10,
				currency: "USD",
			}),
		).rejects.toThrow("There is no outstanding USD balance to settle with this person.");
	});
});

describe("settleAll", () => {
	it("converts each scope at the reference rate and the rows add up to the total", async () => {
		// EUR 1 in each of three scopes; EUR 0.8787 per USD, so EUR 1 = USD 1.14.
		const second = addProject(db, { createdById: ALICE, name: "Rent" }).id;
		for (const projectId of [null, project, second]) {
			seedDebt(aliceRef, bobRef, 1, { currency: "EUR", projectId });
		}

		const result = await alice().settleAll({ toParticipant: bobRef, paymentCurrency: "USD" });

		expect(result.settlements.map((r) => r.convertedAmount)).toEqual([1.14, 1.14, 1.14]);
		expect(result.totalInPaymentCurrency).toBe(3.42);
		expect(headers()[0]).toMatchObject({ amount: "3.42", currency: "USD", rateCurrency: "EUR" });
	});

	it.each([
		["JPY", 186],
		["BTC", 0.00001763],
	])("converts into %s with that currency's decimals", async (currency, expected) => {
		seedDebt(aliceRef, bobRef, 1, { currency: "EUR" });
		const result = await alice().settleAll({ toParticipant: bobRef, paymentCurrency: currency });
		expect(result.totalInPaymentCurrency).toBe(expected);
	});

	it("reports a currency without a rate and refuses when nothing else is owed", async () => {
		seedDebt(aliceRef, bobRef, 7, { currency: "XTS" });
		await expect(
			alice().settleAll({ toParticipant: bobRef, paymentCurrency: "USD" }),
		).rejects.toThrow("no exchange rate available to convert XTS to USD");
	});

	it("stamps the project on every row of a project-scoped settle-all", async () => {
		seedDebt(aliceRef, bobRef, 30, { projectId: project });
		seedDebt(aliceRef, bobRef, 5);
		const result = await alice().settleAll({
			toParticipant: bobRef,
			paymentCurrency: "USD",
			projectId: project,
		});
		expect(result.settlements.map((r) => r.projectId)).toEqual([project]);
		expect(result.totalInPaymentCurrency).toBe(30);
	});
});

describe("confirm and delete", () => {
	it("bob confirms, every row and the header turn final, and alice hears it", async () => {
		seedDebt(aliceRef, bobRef, 30);
		const { settlement } = await alice().initiateSettlement({
			toParticipant: bobRef,
			amount: 30,
			currency: "USD",
		});

		await expect(alice().confirmSettlement(settlement.id)).rejects.toThrow(
			"Only the payee can confirm this settlement",
		);
		const confirmed = await new SettlementService(db as never, "bob").confirmSettlement(
			settlement.id,
		);
		expect(confirmed.status).toBe("FINALIZED");
		expect(headers()[0]?.status).toBe("FINALIZED");
		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({ userId: ALICE, type: "SETTLEMENT_CONFIRMED" }),
		);
		await expect(
			new SettlementService(db as never, "bob").confirmSettlement(settlement.id),
		).rejects.toThrow("Settlement is already confirmed");
		await expect(alice().confirmSettlement("missing")).rejects.toThrow("Settlement not found");
	});

	it("the payer deletes a pending payment with its header", async () => {
		seedDebt(aliceRef, bobRef, 30);
		const { settlement } = await alice().initiateSettlement({
			toParticipant: bobRef,
			amount: 30,
			currency: "USD",
		});
		await alice().deletePendingSettlement(settlement.id);
		expect(rows()).toEqual([]);
		expect(headers()).toEqual([]);
	});
});

describe("plan and history", () => {
	it("returns per-currency balances with directions, from the caller's side", async () => {
		seedDebt(bobRef, aliceRef, 50);
		seedDebt(aliceRef, bobRef, 5000, { currency: "ARS" });

		const plan = await alice().getSettlementPlan(bobRef);

		expect(plan).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ currency: "USD", balance: 50, direction: "they_owe_you", suggestedAmount: 50 }),
				expect.objectContaining({ currency: "ARS", balance: 5000, direction: "you_owe_them" }),
			]),
		);
	});

	it("lists one entry per payment, newest first, with the header's amount and date", async () => {
		seedDebt(aliceRef, bobRef, 50);
		await alice().initiateSettlement({ toParticipant: bobRef, amount: 20, currency: "USD" });

		const [entry] = await alice().getSettlementHistory(bobRef);
		expect(entry).toMatchObject({
			amount: 20,
			currency: "USD",
			direction: "outgoing",
			status: "pending_payee_confirmation",
			canDelete: true,
		});
		expect(entry?.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("rejects a person with no relationship", async () => {
		await expect(alice().getSettlementPlan(bobRef)).rejects.toThrow(
			"No financial relationship found",
		);
		await expect(alice().getSettlementHistory(bobRef)).rejects.toThrow(
			"No financial relationship found",
		);
	});
});
