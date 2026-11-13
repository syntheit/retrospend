/**
 * The billing-period settle check on legacy thirds, on real Postgres
 * (money-decimal PR 6a). Ana paid USD 38.20 and the three shares were stored
 * as 12.73333333 each. Every screen reads one posting (ledger-posting.ts):
 * each share rounds on its own row to 12.73, so Ben and Cam owe Ana 12.73
 * and the 1 cent no share covers is Ana's own:
 *
 *   Ana  3820 - (1273 + 1) = 2546     Ben  -1273     Cam  -1273   (cents)
 *
 * When Ben and Cam each pay the 12.73 the People page shows, the period is
 * settled. The old plan rounded each person's total once (Ana 25.4666666 is
 * 25.47), so after 25.46 came in it still listed Ana as owed 0.01.
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { callerFor } from "../project/__tests__/trip-fixture";
import { projectSettlementPlan } from "../project/group.service";
import { computePeriodSettleStatus } from "./billing-period-settle";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function seedThirds() {
	const [ana, ben, cam] = [
		await createTestUser(),
		await createTestUser(),
		await createTestUser(),
	];
	const project = await adminDb.project.create({
		data: { name: "Thirds", createdById: ana.user.id },
	});
	for (const [u, role] of [
		[ana, "ORGANIZER"],
		[ben, "CONTRIBUTOR"],
		[cam, "CONTRIBUTOR"],
	] as const) {
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: u.user.id,
				role,
			},
		});
	}
	const period = await adminDb.billingPeriod.create({
		data: {
			projectId: project.id,
			label: "October",
			startDate: new Date("2026-10-01T00:00:00Z"),
			endDate: new Date("2026-10-31T00:00:00Z"),
		},
	});
	await adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "38.20",
			currency: "USD",
			date: new Date("2026-10-10"),
			paidByType: "user",
			paidById: ana.user.id,
			createdByType: "user",
			createdById: ana.user.id,
			projectId: project.id,
			billingPeriodId: period.id,
			splitParticipants: {
				create: [ana, ben, cam].map((u) => ({
					participantType: "user" as const,
					participantId: u.user.id,
					shareAmount: "12.73333333",
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
	return { ana, ben, cam, project, period };
}

const pays = (
	projectId: string,
	from: TestUser,
	to: TestUser,
	amount: string,
) =>
	adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: from.user.id,
			toParticipantType: "user",
			toParticipantId: to.user.id,
			amount,
			currency: "USD",
			status: "FINALIZED",
			projectId,
		},
	});

describe("a period of legacy thirds", () => {
	it("is open at 25.46 owed to Ana until Ben and Cam each pay the 12.73 People shows", async () => {
		const t = await seedThirds();
		const ana = callerFor(t.ana.user);
		const summary = await ana.summary({ projectId: t.project.id });
		const usd = (name: TestUser) =>
			summary.members
				.find((m) => m.participantId === name.user.id)
				?.lines.find((l) => l.currency === "USD");
		expect(usd(t.ben)?.balance.minor).toBe(-1273);
		expect(usd(t.cam)?.balance.minor).toBe(-1273);
		expect(usd(t.ana)?.balance.minor).toBe(2546);

		const open = await computePeriodSettleStatus(adminDb, t.period);
		expect(
			open.outstanding.map((o) => [o.participant.participantId, o.amount]),
		).toEqual([
			[t.ana.user.id, 25.46],
			[t.ben.user.id, -12.73],
			[t.cam.user.id, -12.73],
		]);
		const plan = await projectSettlementPlan(adminDb, t.project.id);
		expect(plan.byCurrency.USD?.plan.map((p) => p.amount)).toEqual([
			12.73, 12.73,
		]);

		await pays(t.project.id, t.ben, t.ana, "12.73");
		const half = await computePeriodSettleStatus(adminDb, t.period);
		// Ana is owed 25.46 - 12.73 = 12.73 and Cam still owes 12.73.
		expect(
			half.outstanding.map((o) => [o.participant.participantId, o.amount]),
		).toEqual([
			[t.ana.user.id, 12.73],
			[t.cam.user.id, -12.73],
		]);
	});

	it("is settled once Ben and Cam have paid 12.73 each, and every screen agrees", async () => {
		const t = await seedThirds();
		await pays(t.project.id, t.ben, t.ana, "12.73");
		await pays(t.project.id, t.cam, t.ana, "12.73");

		expect(
			(await computePeriodSettleStatus(adminDb, t.period)).outstanding,
		).toEqual([]);
		const plan = await projectSettlementPlan(adminDb, t.project.id);
		expect(plan.byCurrency.USD?.plan).toEqual([]);
		expect(plan.byCurrency.USD?.balances.map((b) => b.netBalance)).toEqual([
			0, 0, 0,
		]);
		const summary = await callerFor(t.ana.user).summary({
			projectId: t.project.id,
		});
		expect(summary.transfers).toEqual([]);
		expect(summary.balancesAddUp).toBe(true);
	});
});
