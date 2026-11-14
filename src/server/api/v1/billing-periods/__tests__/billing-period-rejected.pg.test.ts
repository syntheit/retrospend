/**
 * A rejected share in the v1 billing period detail. Ana paid ARS 90 in the
 * open period, split 30 each over Ana, Bruno and Caro, and Bruno rejected.
 * byPerson reads like the project Summary: Ana 30 + 30 absorbed = 60, Bruno 0
 * (he owes nothing), Caro 30. In minor units: 6,000, 0 and 3,000.
 *
 * A payer outside the split carries the rejected share too: Ana paid ARS 90
 * for Bruno and Caro at 45 each, Ana not in the split, Bruno rejected. The
 * Summary charges Ana the 45 no share covers: Ana 4,500, Bruno 0, Caro 4,500.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { callerFor } from "../../../../services/project/__tests__/trip-fixture";
import {
	arsUser,
	ref,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import { asMobile, call, expectBody } from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Money = { minor: number; currency: string };

describe("/api/v1 billing period detail with a rejected share", () => {
	let ana: TestUser;
	let bruno: TestUser;
	let caro: TestUser;
	let project: string;
	let period: string;

	beforeAll(async () => {
		await seedRates();
		[ana, bruno, caro] = [await arsUser(), await arsUser(), await arsUser()];
		const made = await adminDb.project.create({
			data: { name: "Asado", primaryCurrency: "ARS", createdById: ana.user.id },
		});
		project = made.id;
		for (const [u, role] of [
			[ana, "ORGANIZER"],
			[bruno, "CONTRIBUTOR"],
			[caro, "CONTRIBUTOR"],
		] as const)
			await adminDb.projectParticipant.create({
				data: { projectId: project, ...ref(u), role },
			});
		period = (
			await adminDb.billingPeriod.create({
				data: {
					projectId: project,
					label: "October",
					startDate: new Date("2026-10-01T00:00:00Z"),
					endDate: new Date("2026-10-31T00:00:00Z"),
				},
			})
		).id;
		await adminDb.sharedTransaction.create({
			data: {
				description: "Asado",
				amount: "90",
				currency: "ARS",
				date: new Date("2026-10-08"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				projectId: project,
				billingPeriodId: period,
				splitParticipants: {
					create: [
						{ ...ref(ana), shareAmount: "30", verificationStatus: "ACCEPTED" },
						{ ...ref(bruno), shareAmount: "30", verificationStatus: "REJECTED" },
						{ ...ref(caro), shareAmount: "30", verificationStatus: "ACCEPTED" },
					],
				},
			},
		});
	});

	it("shows Ana 60, Bruno 0 and Caro 30, the Summary's shares", async () => {
		const detail = await expectBody<{
			byPerson: { person: { id: string }; share: Money[] }[];
		}>(
			await call(`/projects/${project}/billing-periods/${period}`, {
				headers: await asMobile(ana.user.id),
			}),
			contract["billing-periods"].get,
		);
		const shareOf = (u: TestUser) =>
			detail.byPerson.find((p) => p.person.id === u.user.id)?.share;
		expect(shareOf(ana)).toEqual([{ minor: 6_000, currency: "ARS" }]);
		expect(shareOf(bruno)).toEqual([{ minor: 0, currency: "ARS" }]);
		expect(shareOf(caro)).toEqual([{ minor: 3_000, currency: "ARS" }]);

		const summary = await callerFor(ana.user).summary({ projectId: project });
		const summaryShare = (u: TestUser) =>
			summary.members
				.find((m) => m.participantId === u.user.id)
				?.lines.map((l) => l.share.minor) ?? [];
		expect(summaryShare(ana)).toEqual([6_000]);
		expect(summaryShare(bruno)).toEqual([]);
		expect(summaryShare(caro)).toEqual([3_000]);
	});

	it("gives a payer outside the split what a rejected share left uncovered", async () => {
		const outside = (
			await adminDb.project.create({
				data: { name: "Cena", primaryCurrency: "ARS", createdById: ana.user.id },
			})
		).id;
		for (const [u, role] of [
			[ana, "ORGANIZER"],
			[bruno, "CONTRIBUTOR"],
			[caro, "CONTRIBUTOR"],
		] as const)
			await adminDb.projectParticipant.create({
				data: { projectId: outside, ...ref(u), role },
			});
		const other = (
			await adminDb.billingPeriod.create({
				data: {
					projectId: outside,
					label: "October",
					startDate: new Date("2026-10-01T00:00:00Z"),
					endDate: new Date("2026-10-31T00:00:00Z"),
				},
			})
		).id;
		await adminDb.sharedTransaction.create({
			data: {
				description: "Cena",
				amount: "90",
				currency: "ARS",
				date: new Date("2026-10-08"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				projectId: outside,
				billingPeriodId: other,
				splitParticipants: {
					create: [
						{ ...ref(bruno), shareAmount: "45", verificationStatus: "REJECTED" },
						{ ...ref(caro), shareAmount: "45", verificationStatus: "ACCEPTED" },
					],
				},
			},
		});
		const detail = await expectBody<{
			byPerson: { person: { id: string }; share: Money[] }[];
		}>(
			await call(`/projects/${outside}/billing-periods/${other}`, {
				headers: await asMobile(ana.user.id),
			}),
			contract["billing-periods"].get,
		);
		const shareOf = (u: TestUser) =>
			detail.byPerson.find((p) => p.person.id === u.user.id)?.share;
		expect(shareOf(ana)).toEqual([{ minor: 4_500, currency: "ARS" }]);
		expect(shareOf(bruno)).toEqual([{ minor: 0, currency: "ARS" }]);
		expect(shareOf(caro)).toEqual([{ minor: 4_500, currency: "ARS" }]);

		const summary = await callerFor(ana.user).summary({ projectId: outside });
		const summaryShare = (u: TestUser) =>
			summary.members
				.find((m) => m.participantId === u.user.id)
				?.lines.map((l) => l.share.minor) ?? [];
		expect(summaryShare(ana)).toEqual([4_500]);
		expect(summaryShare(bruno)).toEqual([]);
		expect(summaryShare(caro)).toEqual([4_500]);
	});
});
