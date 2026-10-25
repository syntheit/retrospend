/**
 * The People, Person and Settle up reads on real Postgres (RLS on), and the
 * three settle scenarios the sheet must get right, every number worked out
 * by hand before the run.
 *
 * Fixture (ARS home, MONEY-MOVES Example A): Sofía owes Martín ARS 18,000
 * outside projects and BRL 412.50 in Florianópolis; Paz (not on
 * Retrospend) owes Sofía ARS 80,000; Lucía owes Sofía ARS 20,000 and says
 * she paid ARS 5,000 of it (pending, so it does not count for Sofía yet,
 * I5). Rates (Blue, per USD): ARS 1,355 and BRL 5, so BRL 1 = ARS 271.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dayKey } from "@retrospend/domain/time-zone";
import {
	applyPayment,
	previewPayment,
} from "~/server/services/payments/procedures";
import { recordPayment } from "~/server/services/payments/record.mutation";
import { forUser } from "~/server/services/preview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { personPage } from "./detail";
import { peopleOverview } from "./overview";
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

/** `payer` paid `amount`; `debtor` owes all of it. */
async function seedShare(
	payer: ParticipantRef,
	debtor: ParticipantRef,
	amount: string,
	currency: string,
	opts: { projectId?: string; date?: string; title?: string } = {},
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: opts.title ?? "Shared",
			amount,
			currency,
			date: new Date(opts.date ?? "2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			projectId: opts.projectId ?? null,
			splitParticipants: {
				create: [
					{ ...debtor, shareAmount: amount, verificationStatus: "ACCEPTED" },
					{ ...payer, shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

const keyOf = (r: ParticipantRef) => `${r.participantType}:${r.participantId}`;

let sofia: TestUser;
let martin: TestUser;
let lucia: TestUser;
let paz: ParticipantRef;
let floripa: string;
let luciaClaim: string;

beforeAll(async () => {
	await seedRates();
	sofia = await createTestUser();
	martin = await createTestUser();
	lucia = await createTestUser();
	for (const u of [sofia, martin, lucia]) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	}
	floripa = (
		await adminDb.project.create({
			data: {
				name: "Florianópolis",
				createdById: sofia.user.id,
				primaryCurrency: "BRL",
			},
		})
	).id;
	for (const u of [sofia, martin]) {
		await adminDb.projectParticipant.create({
			data: { projectId: floripa, ...ref(u), role: "EDITOR" },
		});
	}
	paz = {
		participantType: "shadow",
		participantId: (
			await adminDb.shadowProfile.create({
				data: { createdById: sofia.user.id, name: "Paz" },
			})
		).id,
	};
	await seedShare(ref(martin), ref(sofia), "18000", "ARS", { title: "Asado" });
	await seedShare(ref(martin), ref(sofia), "412.5", "BRL", {
		projectId: floripa,
		date: "2026-10-09",
		title: "Barco",
	});
	await seedShare(ref(sofia), paz, "80000", "ARS", { date: "2026-10-16" });
	await seedShare(ref(sofia), ref(lucia), "20000", "ARS", {
		date: "2026-10-12",
	});
	const claim = await forUser(lucia.user.id).apply(recordPayment, {
		person: ref(sofia),
		direction: "outgoing",
		currency: "ARS",
		amount: "5000",
		paymentMethod: "Cash",
	});
	if (!claim.value.recorded) throw new Error("Lucía's claim was not recorded");
	luciaClaim = claim.value.paymentId;
});

describe("people.overview", () => {
	it("splits Owed to you and You owe, sizes the bar and lists what waits", async () => {
		const view = await peopleOverview(sofia.db, sofia.user.id);
		// Owed to you: Paz 80,000 + Lucía 20,000 (her claim is pending, I5).
		expect(view.owedToYou).toEqual(ars(10_000_000));
		// You owe: Martín ARS 18,000 + BRL 412.50 x 271 = ARS 129,787.50.
		expect(view.youOwe).toEqual(ars(12_978_750));
		const by = new Map(view.people.map((p) => [p.person.key, p]));
		const m = by.get(keyOf(ref(martin)));
		expect(m?.group).toBe("owe");
		expect(m?.net).toEqual(ars(-12_978_750));
		expect(m?.parts.map((p) => [p.amount.minor, p.home?.minor])).toEqual([
			[-1_800_000, -1_800_000],
			[-41_250, -11_178_750],
		]);
		const l = by.get(keyOf(ref(lucia)));
		expect(l?.group).toBe("owed");
		expect(l?.pending).toEqual({ direction: "in", amount: ars(500_000) });
		expect(l?.needsYou).toBe(1);
		expect(by.get(keyOf(paz))?.person.onRetrospend).toBe(false);
		// Shares of 100,000 + 129,787.50 = 229,787.50, half-even basis points:
		// Paz 80,000 = 3481.48 -> 3481; Lucía 20,000 = 870.37 -> 870;
		// Martín 129,787.50 = 5648.15 -> 5648.
		expect(view.segments.map((s) => [s.key, s.direction, s.share])).toEqual([
			[keyOf(paz), "owed", 3481],
			[keyOf(ref(lucia)), "owed", 870],
			[keyOf(ref(martin)), "owe", 5648],
		]);
		expect(view.needs).toEqual([
			expect.objectContaining({
				kind: "confirmPayment",
				id: luciaClaim,
				amount: ars(500_000),
			}),
		]);
		expect(view.unpriced).toEqual([]);
	});
});

describe("people.page", () => {
	it("gives Martín's balance per currency with its rate, per project, and each row's effect", async () => {
		const page = await personPage(sofia.db, sofia.user.id, ref(martin));
		expect(page.net).toEqual(ars(-12_978_750));
		expect(page.parts[1]).toEqual({
			amount: { minor: -41_250, currency: "BRL" },
			home: ars(-11_178_750),
			rate: {
				type: "blue",
				unit: { minor: 100, currency: "BRL" },
				value: ars(27_100),
			},
		});
		expect(page.scopes.map((s) => [s.project?.name ?? null, s.lines])).toEqual([
			["Florianópolis", [{ minor: -41_250, currency: "BRL" }]],
			[null, [ars(-1_800_000)]],
		]);
		expect(
			page.rows.map((r) => [r.title, r.paidBy, r.effect?.minor, r.state]),
		).toEqual([
			["Barco", "them", -41_250, "ok"],
			["Asado", "them", -1_800_000, "ok"],
		]);
		expect(page.settled.since).toBeNull();
		expect(page.payments).toEqual([]);
	});

	it("shows nothing for someone the user shares nothing with yet", async () => {
		const stranger = await createTestUser();
		const page = await personPage(sofia.db, sofia.user.id, ref(stranger));
		expect(page.settled.nothingShared).toBe(true);
		expect(page.parts).toEqual([]);
		expect(page.rows).toEqual([]);
		expect(page.payments).toEqual([]);
	});
});

describe("settle scenarios", () => {
	it("same currency: ARS 10,000 to Martín pays his ARS line only, and Undo restores it", async () => {
		const ctx = await settleContext(sofia.db, sofia.user.id, {
			person: ref(martin),
		});
		expect(ctx.direction).toBe("outgoing");
		// Everything: 18,000 + 111,787.50 = 129,787.50, to the whole peso 129,788.
		expect(ctx.everything).toEqual(ars(12_978_800));
		expect(ctx.parts).toEqual([
			{ currency: "ARS", full: ars(1_800_000) },
			{ currency: "BRL", full: ars(11_178_800) },
		]);
		const input = {
			person: ref(martin),
			direction: "outgoing" as const,
			currency: "ARS",
			amount: "10000",
		};
		const preview = await previewPayment(sofia.user.id, input);
		// Same currency first: 10,000 of the ARS 18,000; BRL untouched.
		expect(
			preview.changes.map((c) => [
				c.id,
				c.currency,
				c.before?.minor,
				c.after?.minor,
			]),
		).toEqual([
			["balance.person", "ARS", -1_800_000, -800_000],
			["owed.youOwe", "ARS", 12_978_750, 11_978_750],
		]);
		expect(preview.unchanged.map((u) => u.id)).toEqual(["owed.owedToYou"]);
		const applied = await applyPayment(sofia.db, sofia.user.id, input);
		expect(applied.changes).toEqual(preview.changes);
		if (!applied.value.recorded) throw new Error("not recorded");
		expect(applied.value.status).toBe("PROPOSED");
		await undoRecordedPayment(sofia.db, sofia.user.id, applied.value.paymentId);
		const after = await settleContext(sofia.db, sofia.user.id, {
			person: ref(martin),
		});
		expect(after.everything).toEqual(ars(12_978_800));
	});

	it("cross currency: Everything in ARS pays BRL 412.50 at the payment's rate", async () => {
		const input = {
			person: ref(martin),
			direction: "outgoing" as const,
			currency: "ARS",
			amount: "129788",
		};
		const preview = await previewPayment(sofia.user.id, input);
		if (!preview.value.allocation) throw new Error("no allocation");
		// ARS 18,000 first, then ARS 111,788 buys BRL 412.50 at 271 (the
		// ARS 0.50 left is dust and stays on the last row).
		expect(
			preview.value.allocation.rows.map((r) => [
				r.scope,
				r.pays.minor,
				r.pays.currency,
				r.paid.minor,
				r.rate?.perUnit ?? null,
			]),
		).toEqual([
			[null, 1_800_000, "ARS", 1_800_000, null],
			[floripa, 41_250, "BRL", 11_178_800, "271"],
		]);
		expect(
			preview.changes.map((c) => [c.id, c.currency, c.after?.minor ?? null]),
		).toEqual([
			["balance.person", "ARS", null],
			["balance.person", "BRL", null],
			["owed.youOwe", "ARS", 0],
		]);
	});

	it("overpay: ARS 100,000 from Paz is ARS 20,000 more than she owes and needs the confirm", async () => {
		const ctx = await settleContext(sofia.db, sofia.user.id, { person: paz });
		expect(ctx.direction).toBe("incoming");
		expect(ctx.everything).toEqual(ars(8_000_000));
		const input = {
			person: paz,
			direction: "incoming" as const,
			currency: "ARS",
			amount: "100000",
		};
		const preview = await previewPayment(sofia.user.id, input);
		expect(preview.value).toMatchObject({ recorded: false, reason: "overpay" });
		expect(preview.value.allocation?.overpay).toEqual(ars(2_000_000));
		await expect(applyPayment(sofia.db, sofia.user.id, input)).rejects.toThrow(
			/more than is owed/,
		);

		const confirmed = { ...input, allowOverpay: true };
		const ok = await previewPayment(sofia.user.id, confirmed);
		// Paz's 80,000 is paid; the extra 20,000 is now owed to her.
		expect(
			ok.changes.map((c) => [
				c.id,
				c.currency,
				c.before?.minor ?? null,
				c.after?.minor ?? null,
			]),
		).toEqual([
			["balance.person", "ARS", 8_000_000, -2_000_000],
			["owed.owedToYou", "ARS", 10_000_000, 2_000_000],
			["owed.youOwe", "ARS", 12_978_750, 14_978_750],
		]);
		const applied = await applyPayment(sofia.db, sofia.user.id, confirmed);
		if (!applied.value.recorded) throw new Error("not recorded");
		// Money received from someone not on Retrospend is final at once.
		expect(applied.value.status).toBe("FINALIZED");
		await undoRecordedPayment(sofia.db, sofia.user.id, applied.value.paymentId);
		const back = await settleContext(sofia.db, sofia.user.id, { person: paz });
		expect(back.everything).toEqual(ars(8_000_000));
	});

	it("Same payment?: ARS 5,000 from Lucía matches her pending claim", async () => {
		const preview = await previewPayment(sofia.user.id, {
			person: ref(lucia),
			direction: "incoming",
			currency: "ARS",
			amount: "5000",
		});
		expect(preview.value).toMatchObject({
			recorded: false,
			reason: "matches_claim",
		});
		expect(preview.value.match?.claim.paymentId).toBe(luciaClaim);
	});
});
