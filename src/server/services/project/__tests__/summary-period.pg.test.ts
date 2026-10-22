/**
 * The summary for one billing period, and its agreement with the settlement
 * plan on the order of equal debts. Trip values as in trip-fixture.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { callerFor, seedTrip } from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const brl = (minor: number) => ({ minor, currency: "BRL" });

describe("project.summary for one billing period", () => {
	it("counts only the period's expenses and the payments recorded against it", async () => {
		const t = await seedTrip();
		const period = await adminDb.billingPeriod.create({
			data: {
				projectId: t.project.id,
				label: "Oct 9 to 10",
				startDate: new Date("2026-10-09T00:00:00Z"),
				endDate: new Date("2026-10-11T00:00:00Z"),
			},
		});
		await adminDb.sharedTransaction.updateMany({
			where: { id: { in: [t.expenses.hotel.id, t.expenses.car.id] } },
			data: { billingPeriodId: period.id },
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: t.cam.user.id,
				toParticipantType: "user",
				toParticipantId: t.ana.user.id,
				amount: "50",
				currency: "BRL",
				status: "FINALIZED",
				projectId: t.project.id,
				billingPeriodId: period.id,
			},
		});
		const ana = callerFor(t.ana.user);
		const s = await ana.summary({
			projectId: t.project.id,
			periodId: period.id,
		});
		// Hotel 300 + Car 90; Ben's BRL 40 has no period, Cam's BRL 50 does.
		expect(s.total).toEqual([brl(39000)]);
		const lines = Object.fromEntries(
			s.members.map((m) => [
				m.name,
				m.lines.map((l) => [l.received.minor, l.sent.minor, l.balance.minor]),
			]),
		);
		expect(lines).toEqual({
			Ana: [[5000, 0, 12000]], // 300 - 130 - 50
			Ben: [[0, 0, -4000]], // 90 - 130
			Cam: [[0, 5000, -5000]], // 0 - 100 + 50
			Sam: [[0, 0, -3000]], // 0 - 30
		});
		expect(s.balancesAddUp).toBe(true);

		// The settlement plan keeps its rule: every project payment counts.
		const plan = await ana.participantBalances({
			projectId: t.project.id,
			periodId: period.id,
		});
		const anaPlan = plan.balances.find(
			(b) => b.participant.participantId === t.ana.user.id,
		);
		expect(anaPlan?.netBalance).toBe(80); // 300 - 130 - 40 - 50
	});
});

describe("summary and settlement plan agree on order", () => {
	it("lists equal debts in the same order", async () => {
		const t = await seedTrip();
		const ana = callerFor(t.ana.user);
		const s = await ana.summary({ projectId: t.project.id });
		const plan = await ana.settlementPlan({ projectId: t.project.id });
		const fromPlan = ["BRL", "USD"].flatMap((cur) =>
			(plan.byCurrency[cur]?.plan ?? []).map((p) => [
				p.from.participantId,
				p.to.participantId,
				Math.round(p.amount * 100),
			]),
		);
		expect(fromPlan).toHaveLength(4);
		expect(
			s.transfers.map((x) => [
				x.from.participantId,
				x.to.participantId,
				x.amount.minor,
			]),
		).toEqual(fromPlan);
	});
});
