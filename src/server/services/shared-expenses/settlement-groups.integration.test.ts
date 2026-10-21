/**
 * Payment groups, offsets, "square up projects" and billing-period reopen,
 * end to end through SettlementService and the real balance code on the
 * stateful in-memory DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import { createNotification } from "~/server/services/notifications";
import { computeBalance } from "./balance";
import { RECORDED_BY_PAYEE_REASON, SettlementService } from "./settlement.service";
import {
	addBillingPeriod,
	addShadowProfile,
	addProject,
	addProjectParticipant,
	createStatefulDb,
	makeShadowRef,
	makeUserRef,
} from "./test-utils";

const ALICE = "alice";
const BOB = "bob";
const GHOST = "shadow-1";
const aliceRef = makeUserRef(ALICE);
const bobRef = makeUserRef(BOB);
const ghostRef = makeShadowRef(GHOST);

type Ref = { participantType: "user" | "shadow" | "guest"; participantId: string };

let db: ReturnType<typeof createStatefulDb>;
let trip: string;
let rent: string;

/**
 * `creditor` paid an expense of which `debtor` owes `amount`; the creditor's
 * own share is 0 so only the pairwise debt matters.
 */
function seedDebt(
	debtor: Ref,
	creditor: Ref,
	projectId: string | null,
	amount: number,
	opts: { currency?: string; billingPeriodId?: string | null } = {},
) {
	const txId = `tx-${db._stores.transactions.size + 1}`;
	db._stores.transactions.set(txId, {
		id: txId,
		description: "Shared expense",
		amount,
		currency: opts.currency ?? "USD",
		date: new Date("2026-03-10"),
		paidByType: creditor.participantType,
		paidById: creditor.participantId,
		createdByType: creditor.participantType,
		createdById: creditor.participantId,
		splitMode: "EXACT",
		projectId,
		billingPeriodId: opts.billingPeriodId ?? null,
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
	return txId;
}

/** Balance from alice's side (positive = bob owes alice). */
async function aliceBalance(projectScope?: string | null) {
	const { byCurrency } = await computeBalance(
		db as never,
		aliceRef,
		bobRef,
		projectScope === undefined ? undefined : { projectScope },
	);
	return byCurrency;
}

const rows = () => [...db._stores.settlements.values()];
const audits = (action: string) =>
	(db._stores.audits as Array<Record<string, unknown>>).filter(
		(a) => a.action === action && a.targetType === "SETTLEMENT",
	);

/** Serializes transactions that take the pair lock, like pg_advisory_xact_lock. */
function withPairLock() {
	let chain: Promise<void> = Promise.resolve();
	db.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => {
		let release: () => void = () => {};
		const tx = {
			...db,
			$executeRaw: vi.fn(async () => {
				const previous = chain;
				chain = new Promise<void>((r) => {
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
	}) as never);
}

beforeEach(() => {
	vi.mocked(createNotification).mockClear();
	db = createStatefulDb();
	addShadowProfile(db, { createdById: ALICE, name: "Ghost" });
	trip = addProject(db, { createdById: ALICE, name: "Trip" }).id;
	rent = addProject(db, { createdById: ALICE, name: "Rent" }).id;
	for (const projectId of [trip, rent]) {
		for (const [participantType, participantId] of [
			["user", ALICE],
			["user", BOB],
			["shadow", GHOST],
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

// ── Task A: payment groups ──────────────────────────────────────────────────

describe("payment groups", () => {
	beforeEach(() => {
		seedDebt(aliceRef, bobRef, trip, 60);
		seedDebt(aliceRef, bobRef, rent, 40);
	});

	async function alicePays100() {
		return new SettlementService(db as never, ALICE).initiateSettlement({
			toParticipant: bobRef,
			amount: 100,
			currency: "USD",
		});
	}

	it("one global payment is one group, one history entry, one notification", async () => {
		await alicePays100();

		const created = rows();
		expect(created).toHaveLength(2);
		const groupId = created[0]!.paymentGroupId;
		expect(groupId).toBeTruthy();
		expect(created.every((r) => r.paymentGroupId === groupId)).toBe(true);
		expect(created.every((r) => !r.isOffset)).toBe(true);
		expect(createNotification).toHaveBeenCalledTimes(1);

		for (const userId of [ALICE, BOB]) {
			const history = await new SettlementService(
				db as never,
				userId,
			).getSettlementHistory(userId === ALICE ? bobRef : aliceRef);
			expect(history).toHaveLength(1);
			expect(history[0]).toMatchObject({
				amount: 100,
				currency: "USD",
				kind: "payment",
				status: "pending_payee_confirmation",
				direction: userId === ALICE ? "outgoing" : "incoming",
				canConfirm: userId === BOB,
				canDelete: userId === ALICE,
			});
			expect(
				history[0]!.parts.map((p) => [p.projectName, p.amount]).sort(),
			).toEqual([
				["Rent", 40],
				["Trip", 60],
			]);
		}

		// Each project feed gets one CREATED entry for its own part.
		const createdAudits = audits("CREATED");
		expect(createdAudits).toHaveLength(2);
		for (const a of createdAudits) {
			expect(a.changes).toMatchObject({
				paymentGroupId: groupId,
				allocatedFromTotal: 100,
			});
		}
		expect(createdAudits.map((a) => a.projectId).sort()).toEqual(
			[trip, rent].sort(),
		);
	});

	it("confirming any row confirms the whole group, with one notification", async () => {
		await alicePays100();
		const second = rows()[1]!;
		vi.mocked(createNotification).mockClear();

		await new SettlementService(db as never, BOB).confirmSettlement(second.id);

		expect(rows().every((r) => r.status === "FINALIZED")).toBe(true);
		expect(rows().every((r) => r.confirmedByPayer && r.confirmedByPayee)).toBe(
			true,
		);
		expect(audits("SETTLED")).toHaveLength(1);
		expect(createNotification).toHaveBeenCalledTimes(1);
		expect(await aliceBalance()).toEqual({});
	});

	it("rejecting rejects the whole group; the other row cannot be confirmed after", async () => {
		await alicePays100();
		const [first, second] = rows();
		const bobService = new SettlementService(db as never, BOB);

		await bobService.rejectSettlement(first!.id, "not received");

		expect(rows().every((r) => r.status === "REJECTED")).toBe(true);
		await expect(bobService.confirmSettlement(second!.id)).rejects.toThrow(
			"already rejected",
		);
		// The debt is back in every scope.
		expect(await aliceBalance(trip)).toEqual({ USD: -60 });
		expect(await aliceBalance(rent)).toEqual({ USD: -40 });
		expect(audits("REJECTED")).toHaveLength(1);
	});

	it("only the payer deletes a pending group, and it goes as a whole", async () => {
		await alicePays100();
		const id = rows()[1]!.id;

		await expect(
			new SettlementService(db as never, BOB).deletePendingSettlement(id),
		).rejects.toThrow("Only the payer can delete");
		await new SettlementService(db as never, ALICE).deletePendingSettlement(id);

		expect(rows()).toHaveLength(0);
		expect(await aliceBalance()).toEqual({ USD: -100 });
	});

	it("reminds once per group and keeps the rows in step", async () => {
		await alicePays100();
		const alice = new SettlementService(db as never, ALICE);
		vi.mocked(createNotification).mockClear();

		await alice.sendReminder(rows()[0]!.id);

		expect(rows().map((r) => r.reminderCount)).toEqual([1, 1]);
		expect(createNotification).toHaveBeenCalledTimes(1);
		await expect(alice.sendReminder(rows()[1]!.id)).rejects.toThrow(
			"24 hours",
		);
	});

	it("pending-for-me lists the group once", async () => {
		await alicePays100();
		const pending = await new SettlementService(
			db as never,
			BOB,
		).getPendingForMe();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			amount: 100,
			fromParticipantId: ALICE,
		});
		expect(
			await new SettlementService(db as never, ALICE).getPendingForMe(),
		).toEqual([]);
	});

	it("voiding an auto-finalized group to a ghost removes every row", async () => {
		seedDebt(aliceRef, ghostRef, trip, 10);
		seedDebt(aliceRef, ghostRef, rent, 5);
		const alice = new SettlementService(db as never, ALICE);
		await alice.initiateSettlement({
			toParticipant: ghostRef,
			amount: 15,
			currency: "USD",
		});
		const ghostRows = rows().filter((r) => r.toParticipantId === GHOST);
		expect(ghostRows).toHaveLength(2);
		expect(ghostRows.every((r) => r.status === "FINALIZED")).toBe(true);

		await alice.voidAutoFinalizedSettlement(ghostRows[1]!.id);

		expect(rows().filter((r) => r.toParticipantId === GHOST)).toHaveLength(0);
	});
});

// ── Task B: offsets ─────────────────────────────────────────────────────────

describe("offsets on a full settle-up", () => {
	it("Trip/Rent: alice owes the net, settle all pays 20 and squares both projects", async () => {
		seedDebt(aliceRef, bobRef, trip, 50);
		seedDebt(bobRef, aliceRef, rent, 30);
		expect(await aliceBalance()).toEqual({ USD: -20 });

		const result = await new SettlementService(db as never, ALICE).settleAll({
			toParticipant: bobRef,
			paymentCurrency: "USD",
		});

		expect(result.totalInPaymentCurrency).toBe(20);
		const created = rows();
		expect(created.map((r) => [r.projectId, r.fromParticipantId, Number(r.amount), r.isOffset])).toEqual([
			[trip, ALICE, 20, false],
			[trip, ALICE, 30, true],
			[rent, BOB, 30, true],
		]);
		expect(new Set(created.map((r) => r.paymentGroupId)).size).toBe(1);
		// Cash moved is the net; every scope is even.
		expect(await aliceBalance(trip)).toEqual({});
		expect(await aliceBalance(rent)).toEqual({});
		expect(await aliceBalance()).toEqual({});

		// Pending until bob confirms, offsets included; bob confirms it all.
		expect(created.every((r) => r.status === "PROPOSED")).toBe(true);
		const offsetFromBob = created[2]!;
		expect(offsetFromBob).toMatchObject({
			confirmedByPayer: false,
			confirmedByPayee: true,
		});
		await new SettlementService(db as never, BOB).confirmSettlement(
			offsetFromBob.id,
		);
		expect(rows().every((r) => r.status === "FINALIZED")).toBe(true);

		const [entry] = await new SettlementService(
			db as never,
			ALICE,
		).getSettlementHistory(bobRef);
		expect(entry).toMatchObject({
			amount: 20,
			offsetByCurrency: [{ currency: "USD", amount: 30 }],
			status: "confirmed",
		});
	});

	it("Trip/Rent the other way: bob owes the net and pays exactly the full amount", async () => {
		seedDebt(bobRef, aliceRef, trip, 50);
		seedDebt(aliceRef, bobRef, rent, 30);

		await new SettlementService(db as never, BOB).initiateSettlement({
			toParticipant: aliceRef,
			amount: 20,
			currency: "USD",
		});

		expect(
			rows().map((r) => [r.projectId, r.fromParticipantId, Number(r.amount), r.isOffset]),
		).toEqual([
			[trip, BOB, 20, false],
			[trip, BOB, 30, true],
			[rent, ALICE, 30, true],
		]);
		expect(await aliceBalance(trip)).toEqual({});
		expect(await aliceBalance(rent)).toEqual({});

		// alice is awaited on every row, including the one she "pays".
		const [entry] = await new SettlementService(
			db as never,
			ALICE,
		).getSettlementHistory(bobRef);
		expect(entry).toMatchObject({ canConfirm: true, direction: "incoming" });
	});

	it("a payment recorded as received offsets too and is voidable by the payee", async () => {
		seedDebt(bobRef, aliceRef, trip, 50);
		seedDebt(aliceRef, bobRef, rent, 30);
		const alice = new SettlementService(db as never, ALICE);

		await alice.settleAll({
			toParticipant: bobRef,
			direction: "incoming",
			paymentCurrency: "USD",
		});

		expect(rows()).toHaveLength(3);
		expect(rows().every((r) => r.status === "FINALIZED")).toBe(true);
		expect(
			rows().every((r) => r.autoConfirmedReason === RECORDED_BY_PAYEE_REASON),
		).toBe(true);
		expect(await aliceBalance()).toEqual({});

		const [entry] = await alice.getSettlementHistory(bobRef);
		expect(entry).toMatchObject({ canVoid: true, direction: "incoming" });
		await alice.voidAutoFinalizedSettlement(entry!.id);

		expect(rows()).toHaveLength(0);
		expect(await aliceBalance(trip)).toEqual({ USD: 50 });
		expect(await aliceBalance(rent)).toEqual({ USD: -30 });
	});

	it("a partial payment never offsets", async () => {
		seedDebt(aliceRef, bobRef, trip, 50);
		seedDebt(bobRef, aliceRef, rent, 30);

		await new SettlementService(db as never, ALICE).initiateSettlement({
			toParticipant: bobRef,
			amount: 15,
			currency: "USD",
		});

		expect(rows().map((r) => [r.projectId, Number(r.amount), r.isOffset])).toEqual([
			[trip, 15, false],
		]);
		expect(await aliceBalance(trip)).toEqual({ USD: -35 });
		expect(await aliceBalance(rent)).toEqual({ USD: 30 });
	});

	it("never nets across currencies, and the plan reports the other currency", async () => {
		seedDebt(aliceRef, bobRef, trip, 50);
		seedDebt(bobRef, aliceRef, rent, 30);
		// bob also owes alice 30,000 ARS: the opposite way, another currency.
		seedDebt(bobRef, aliceRef, trip, 30000, { currency: "ARS" });
		const alice = new SettlementService(db as never, ALICE);

		const plan = await alice.getSettlementPlan(bobRef);
		expect(plan).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					currency: "USD",
					direction: "you_owe_them",
					balance: 20,
					offsetAmount: 30,
				}),
				expect.objectContaining({
					currency: "ARS",
					direction: "they_owe_you",
					balance: 30000,
					offsetAmount: 0,
				}),
			]),
		);

		await alice.settleAll({ toParticipant: bobRef, paymentCurrency: "USD" });

		expect(rows().every((r) => r.currency === "USD")).toBe(true);
		expect(await aliceBalance()).toEqual({ ARS: 30000 });
	});

	it("the over-payment cap still holds with opposite debts present", async () => {
		seedDebt(aliceRef, bobRef, trip, 50);
		seedDebt(bobRef, aliceRef, rent, 30);
		const alice = new SettlementService(db as never, ALICE);

		await expect(
			alice.initiateSettlement({ toParticipant: bobRef, amount: 21, currency: "USD" }),
		).rejects.toThrow(/exceeds the outstanding balance/);

		await alice.initiateSettlement({ toParticipant: bobRef, amount: 20, currency: "USD" });
		await expect(
			alice.initiateSettlement({ toParticipant: bobRef, amount: 1, currency: "USD" }),
		).rejects.toThrow(/exceeds the outstanding balance/);
	});

	it("two concurrent full settle-ups: the pair lock lets one through", async () => {
		seedDebt(aliceRef, bobRef, trip, 50);
		seedDebt(bobRef, aliceRef, rent, 30);
		withPairLock();
		const alice = new SettlementService(db as never, ALICE);
		const settle = () =>
			alice.settleAll({ toParticipant: bobRef, paymentCurrency: "USD" });

		const results = await Promise.allSettled([settle(), settle()]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(rows()).toHaveLength(3);
		expect(await aliceBalance(trip)).toEqual({});
		expect(await aliceBalance(rent)).toEqual({});
	});
});

// ── Task B.3: square up projects ────────────────────────────────────────────

describe("square up projects", () => {
	beforeEach(() => {
		seedDebt(aliceRef, bobRef, trip, 30);
		seedDebt(bobRef, aliceRef, rent, 30);
	});

	it("offers the action when the overall balance is even but projects are not", async () => {
		const alice = new SettlementService(db as never, ALICE);
		expect(await aliceBalance()).toEqual({});

		const options = await alice.getSquareUpOptions(bobRef);
		expect(options).toHaveLength(1);
		expect(options[0]).toMatchObject({ currency: "USD", amount: 30 });
		expect(
			options[0]!.scopes.map((s) => [s.projectName, s.balance]).sort(),
		).toEqual([
			["Rent", 30],
			["Trip", -30],
		]);
		// Nothing to pay, so a payment is refused.
		await expect(
			alice.initiateSettlement({ toParticipant: bobRef, amount: 1, currency: "USD" }),
		).rejects.toThrow();
	});

	it("records offsets only, pending bob, who can reject them", async () => {
		const alice = new SettlementService(db as never, ALICE);
		const result = await alice.squareUpProjects({
			toParticipant: bobRef,
			currency: "USD",
		});

		expect(result.requiresPayeeConfirmation).toBe(true);
		expect(rows()).toHaveLength(2);
		expect(rows().every((r) => r.isOffset && r.status === "PROPOSED")).toBe(true);
		expect(await aliceBalance(trip)).toEqual({});
		expect(await aliceBalance(rent)).toEqual({});
		expect(await alice.getSquareUpOptions(bobRef)).toEqual([]);

		const bob = new SettlementService(db as never, BOB);
		const [entry] = await bob.getSettlementHistory(aliceRef);
		expect(entry).toMatchObject({
			kind: "square_up",
			amount: 30,
			canConfirm: true,
			canReject: true,
		});

		await bob.rejectSettlement(entry!.id);
		expect(await aliceBalance(trip)).toEqual({ USD: -30 });
		expect(await aliceBalance(rent)).toEqual({ USD: 30 });
	});

	it("is auto-confirmed with a ghost", async () => {
		seedDebt(aliceRef, ghostRef, trip, 12);
		seedDebt(ghostRef, aliceRef, rent, 12);

		const result = await new SettlementService(
			db as never,
			ALICE,
		).squareUpProjects({ toParticipant: ghostRef, currency: "USD" });

		expect(result.requiresPayeeConfirmation).toBe(false);
		expect(
			rows()
				.filter((r) => r.paymentGroupId === result.paymentGroupId)
				.every((r) => r.status === "FINALIZED"),
		).toBe(true);
	});

	it("is refused when the overall balance is not even", async () => {
		seedDebt(aliceRef, bobRef, trip, 5);
		await expect(
			new SettlementService(db as never, ALICE).squareUpProjects({
				toParticipant: bobRef,
				currency: "USD",
			}),
		).rejects.toThrow(/no USD project balances to square up/);
		expect(rows()).toHaveLength(0);
	});
});

// ── Task C: reopen a billing period ─────────────────────────────────────────

describe("billing period reopen", () => {
	it("a rejected payment reopens the period it settled; other periods stay settled", async () => {
		const period = addBillingPeriod(db, { projectId: trip, status: "OPEN" });
		const rentPeriod = addBillingPeriod(db, {
			projectId: rent,
			status: "SETTLED",
			settledAt: new Date(),
		});
		const txId = seedDebt(aliceRef, bobRef, trip, 40, {
			billingPeriodId: period.id,
		});

		await new SettlementService(db as never, ALICE).initiateSettlement({
			toParticipant: bobRef,
			amount: 40,
			currency: "USD",
		});
		// The organizer settles the period while the payment is still pending
		// (PROPOSED counts toward balances): status SETTLED, expenses locked.
		db._stores.billingPeriods.set(period.id, {
			...db._stores.billingPeriods.get(period.id)!,
			status: "SETTLED",
			settledAt: new Date(),
		});
		db._stores.transactions.set(txId, {
			...db._stores.transactions.get(txId)!,
			isLocked: true,
		});

		await new SettlementService(db as never, BOB).rejectSettlement(rows()[0]!.id);

		expect(db._stores.billingPeriods.get(period.id)).toMatchObject({
			status: "CLOSING",
			settledAt: null,
		});
		expect(db._stores.transactions.get(txId)!.isLocked).toBe(false);
		expect(db._stores.billingPeriods.get(rentPeriod.id)!.status).toBe(
			"SETTLED",
		);
		const reopened = (db._stores.audits as Array<Record<string, unknown>>).filter(
			(a) => a.action === "PERIOD_REOPENED",
		);
		expect(reopened).toHaveLength(1);
		expect(reopened[0]).toMatchObject({
			targetType: "BILLING_PERIOD",
			targetId: period.id,
			projectId: trip,
		});
	});

	it("a period stays settled when the confirmed payment stands", async () => {
		const period = addBillingPeriod(db, { projectId: trip, status: "OPEN" });
		seedDebt(aliceRef, bobRef, trip, 40, { billingPeriodId: period.id });
		await new SettlementService(db as never, ALICE).initiateSettlement({
			toParticipant: bobRef,
			amount: 40,
			currency: "USD",
		});
		db._stores.billingPeriods.set(period.id, {
			...db._stores.billingPeriods.get(period.id)!,
			status: "SETTLED",
		});
		// An unrelated pending payment in another project is deleted.
		seedDebt(aliceRef, bobRef, rent, 10);
		await new SettlementService(db as never, ALICE).initiateSettlement({
			toParticipant: bobRef,
			amount: 10,
			currency: "USD",
			projectId: rent,
		});
		const rentRow = rows().find((r) => r.projectId === rent)!;

		await new SettlementService(db as never, ALICE).deletePendingSettlement(
			rentRow.id,
		);

		expect(db._stores.billingPeriods.get(period.id)!.status).toBe("SETTLED");
	});

	it("voiding a ghost payment reopens the period too", async () => {
		const period = addBillingPeriod(db, { projectId: trip, status: "OPEN" });
		seedDebt(aliceRef, ghostRef, trip, 25, { billingPeriodId: period.id });
		const alice = new SettlementService(db as never, ALICE);
		await alice.initiateSettlement({
			toParticipant: ghostRef,
			amount: 25,
			currency: "USD",
			projectId: trip,
		});
		db._stores.billingPeriods.set(period.id, {
			...db._stores.billingPeriods.get(period.id)!,
			status: "SETTLED",
		});

		await alice.voidAutoFinalizedSettlement(rows()[0]!.id);

		expect(db._stores.billingPeriods.get(period.id)!.status).toBe("CLOSING");
	});
});
