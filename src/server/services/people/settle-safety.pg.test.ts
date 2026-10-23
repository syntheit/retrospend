/**
 * Settle up on real Postgres, the review round's cases, every number worked
 * out by hand: who may read and undo what, a balance in two currencies
 * going both ways, a currency part paying only its currency, and "Same
 * payment" confirming a claim and Undo putting the claim back exactly.
 *
 * Fixture (ARS home): Sofía paid ARS 20,000 for Lucía; Lucía paid BRL 50
 * for Sofía. Martín owes Sofía ARS 1,000 and BRL 10. Rates (Blue, per USD):
 * ARS 1,355 and BRL 5, so BRL 1 = ARS 271.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dayKey } from "~/lib/time-zone";
import { unconfirmPayment } from "~/server/services/payments/confirm.mutation";
import {
	applyPayment,
	previewPayment,
} from "~/server/services/payments/procedures";
import { recordPayment } from "~/server/services/payments/record.mutation";
import { forUser } from "~/server/services/preview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { personPage } from "./detail";
import { settleContext } from "./settle-context";
import { undoRecordedPayment } from "./undo-payment";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const ars = (minor: number) => ({ minor, currency: "ARS" });

async function seedRates() {
	for (const [currency, rate] of [
		["ARS", "1355"],
		["BRL", "5"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency, type: "blue" } },
			create: { date: today, currency, type: "blue", rate },
			update: { rate },
		});
	}
}

async function seedShare(
	payer: ParticipantRef,
	debtor: ParticipantRef,
	amount: string,
	currency: string,
) {
	await adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount,
			currency,
			date: new Date("2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			splitParticipants: {
				create: [
					{ ...debtor, shareAmount: amount, verificationStatus: "ACCEPTED" },
					{ ...payer, shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

let sofia: TestUser;
let lucia: TestUser;
let martin: TestUser;
let stranger: TestUser;

beforeAll(async () => {
	await seedRates();
	sofia = await createTestUser();
	lucia = await createTestUser();
	martin = await createTestUser();
	stranger = await createTestUser();
	for (const u of [sofia, lucia, martin, stranger]) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	}
	await seedShare(ref(sofia), ref(lucia), "20000", "ARS");
	await seedShare(ref(lucia), ref(sofia), "50", "BRL");
	await seedShare(ref(sofia), ref(martin), "1000", "ARS");
	await seedShare(ref(sofia), ref(martin), "10", "BRL");
});

describe("security", () => {
	it("refuses a settle context with someone you share nothing with", async () => {
		await expect(
			settleContext(sofia.db, sofia.user.id, { person: ref(stranger) }),
		).rejects.toThrow();
	});

	it("shows a stranger nothing of what others share", async () => {
		const page = await personPage(stranger.db, stranger.user.id, ref(lucia));
		expect(page.rows).toEqual([]);
		expect(page.payments).toEqual([]);
		expect(page.parts).toEqual([]);
	});

	it("lets nobody but the recorder undo a payment", async () => {
		const applied = await applyPayment(sofia.db, sofia.user.id, {
			person: ref(martin),
			direction: "incoming",
			currency: "ARS",
			amount: "500",
		});
		if (!applied.value.recorded) throw new Error("not recorded");
		const id = applied.value.paymentId;
		await expect(
			undoRecordedPayment(stranger.db, stranger.user.id, id),
		).rejects.toThrow();
		await expect(
			undoRecordedPayment(martin.db, martin.user.id, id),
		).rejects.toThrow();
		await undoRecordedPayment(sofia.db, sofia.user.id, id);
		expect(await adminDb.payment.count({ where: { id } })).toBe(0);
	});
});

describe("two currencies both ways", () => {
	it("Everything is the net, and the other currency is offset at the payment's rate", async () => {
		// Lucía owes ARS 20,000; Sofía owes BRL 50 = ARS 13,550. Net: ARS 6,450.
		const mine = await settleContext(sofia.db, sofia.user.id, {
			person: ref(lucia),
		});
		expect(mine.direction).toBe("incoming");
		expect(mine.everything).toEqual(ars(645_000));
		const hers = await settleContext(lucia.db, lucia.user.id, {
			person: ref(sofia),
		});
		expect(hers.direction).toBe("outgoing");
		expect(hers.everything).toEqual(ars(645_000));

		const preview = await previewPayment(sofia.user.id, {
			person: ref(lucia),
			direction: "incoming",
			currency: "ARS",
			amount: "6450",
		});
		const a = preview.value.allocation;
		if (!a) throw new Error("no allocation");
		expect(a.everything).toBe(true);
		// Cash pays ARS 6,450 of the 20,000; the other ARS 13,550 is offset
		// against Sofía's BRL 50, worth ARS 13,550 at 271.
		expect(a.rows.map((r) => [r.pays.minor, r.pays.currency])).toEqual([
			[645_000, "ARS"],
		]);
		expect(
			a.offsets.map((o) => [
				o.cancels.minor,
				o.cancels.currency,
				o.value.minor,
			]),
		).toEqual(
			expect.arrayContaining([
				[5000, "BRL", 1_355_000],
				[1_355_000, "ARS", 1_355_000],
			]),
		);
		expect(
			preview.changes.every(
				(c) => c.id !== "balance.person" || c.after === null,
			),
		).toBe(true);
	});
});

describe("currency parts", () => {
	it("the BRL part pays BRL only: ARS 2,710 buys BRL 10 at 271 and leaves the ARS line", async () => {
		const ctx = await settleContext(sofia.db, sofia.user.id, {
			person: ref(martin),
		});
		expect(ctx.parts).toEqual([
			{ currency: "ARS", full: ars(100_000) },
			{ currency: "BRL", full: ars(271_000) },
		]);
		const preview = await previewPayment(sofia.user.id, {
			person: ref(martin),
			direction: "incoming",
			currency: "ARS",
			amount: "2710",
			applyTo: [{ currency: "BRL" }],
		});
		expect(
			preview.value.allocation?.rows.map((r) => [
				r.pays.minor,
				r.pays.currency,
				r.paid.minor,
			]),
		).toEqual([[1000, "BRL", 271_000]]);
		expect(
			preview.changes
				.filter((c) => c.id === "balance.person")
				.map((c) => [c.currency, c.after?.minor ?? null]),
		).toEqual([["BRL", null]]);
	});
});

describe("Same payment and Undo", () => {
	let claimId: string;
	/** Her rows as she recorded them: amount and currency per row, sorted. */
	let original: string[];
	const rowsOf = async () =>
		(await adminDb.settlement.findMany({ where: { paymentGroupId: claimId } }))
			.map((r) => `${r.isOffset ? "offset" : "cash"} ${r.currency} ${r.amount}`)
			.sort();

	beforeAll(async () => {
		const claim = await forUser(lucia.user.id).apply(recordPayment, {
			person: ref(sofia),
			direction: "outgoing",
			currency: "ARS",
			amount: "5000",
			paymentMethod: "Cash",
			paidOn: "2026-10-15",
		});
		if (!claim.value.recorded) throw new Error("claim not recorded");
		claimId = claim.value.paymentId;
		original = await rowsOf();
	});

	it("refuses to confirm a claim in another currency", async () => {
		await expect(
			applyPayment(sofia.db, sofia.user.id, {
				person: ref(lucia),
				direction: "incoming",
				currency: "BRL",
				amount: "18.45",
				matchClaimId: claimId,
			}),
		).rejects.toThrow(/recorded in ARS/);
	});

	it("keeps her amount, date and method when nothing was changed", async () => {
		const applied = await applyPayment(sofia.db, sofia.user.id, {
			person: ref(lucia),
			direction: "incoming",
			currency: "ARS",
			amount: "5000",
			paidOn: "2026-10-15",
			matchClaimId: claimId,
		});
		expect(applied.value).toMatchObject({ recorded: true, paymentId: claimId });
		const header = await adminDb.payment.findUniqueOrThrow({
			where: { id: claimId },
		});
		expect(header.amount.toString()).toBe("5000");
		expect(header.paymentMethod).toBe("Cash");
		expect(header.status).toBe("FINALIZED");
		await forUser(sofia.user.id).apply(unconfirmPayment, {
			paymentId: claimId,
			person: ref(lucia),
		});
	});

	it("Undo after a changed confirm puts her record back: amount, date, method, rows", async () => {
		await applyPayment(sofia.db, sofia.user.id, {
			person: ref(lucia),
			direction: "incoming",
			currency: "ARS",
			amount: "4000",
			paidOn: "2026-10-16",
			paymentMethod: "bank_transfer",
			matchClaimId: claimId,
		});
		const changed = await adminDb.payment.findUniqueOrThrow({
			where: { id: claimId },
			include: { settlements: true },
		});
		expect(changed.amount.toString()).toBe("4000");
		expect(changed.paymentMethod).toBe("bank_transfer");

		await forUser(sofia.user.id).apply(unconfirmPayment, {
			paymentId: claimId,
			person: ref(lucia),
		});
		const back = await adminDb.payment.findUniqueOrThrow({
			where: { id: claimId },
			include: { settlements: true },
		});
		expect(back.status).toBe("PROPOSED");
		expect(back.amount.toString()).toBe("5000");
		expect(back.paidOn.toISOString().slice(0, 10)).toBe("2026-10-15");
		expect(back.paymentMethod).toBe("Cash");
		// Her rows again, as she wrote them, waiting for Sofía.
		expect(await rowsOf()).toEqual(original);
		expect(
			back.settlements.every(
				(r) =>
					r.status === "PROPOSED" && r.confirmedByPayer && !r.confirmedByPayee,
			),
		).toBe(true);
	});
});
