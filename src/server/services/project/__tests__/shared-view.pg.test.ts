/**
 * The project page for people with no account on it, on Postgres: a guest, a
 * viewer link and the public page. The money between people is a member's
 * business: a guest sees their own, a viewer link and the public see none.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	anonymousCaller,
	seedGuest,
	seedTrip,
	type Trip,
} from "./trip-fixture";
import { PAGE_ROWS } from "../page-view";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

let trip: Trip;
let viewerLinkId: string;

beforeAll(async () => {
	trip = await seedTrip();
	viewerLinkId = randomUUID();
	await adminDb.magicLink.create({
		data: {
			id: viewerLinkId,
			projectId: trip.project.id,
			roleGranted: "VIEWER",
			createdById: trip.ana.user.id,
		},
	});
});

const link = (id = viewerLinkId) => anonymousCaller({ "x-viewer-link-id": id });

describe("sharedPageView for a viewer link", () => {
	it("shows the expenses and the total, and no payments or balances", async () => {
		const v = await link().sharedPageView({ id: trip.project.id });
		expect(v.myRole).toBe("VIEWER");
		expect(v.expenseCount).toBe(4);
		expect(v.expenses).toHaveLength(4);
		expect(v.payments).toEqual([]);
		expect(v.myShare).toEqual([]);
		for (const m of v.members) {
			expect(m.isMe).toBe(false);
			expect(m.withMe).toEqual([]);
		}
		for (const e of v.expenses) expect(e.share).toBeNull();
	});

	it("is refused the summary, the plan and every balance read", async () => {
		const id = trip.project.id;
		const calls = [
			() => link().summary({ projectId: id }),
			() => link().settlementPlan({ projectId: id }),
			() => link().participantBalances({ projectId: id }),
			() =>
				link().balancesFromPerspective({
					projectId: id,
					perspective: {
						participantType: "user",
						participantId: trip.ana.user.id,
					},
				}),
		];
		for (const call of calls)
			await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("is refused for another project", async () => {
		const other = await adminDb.project.create({
			data: { name: "Other", createdById: trip.ana.user.id },
		});
		await expect(
			link().sharedPageView({ id: other.id }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("stops working when the link expires or is revoked", async () => {
		const expired = randomUUID();
		await adminDb.magicLink.create({
			data: {
				id: expired,
				projectId: trip.project.id,
				roleGranted: "VIEWER",
				createdById: trip.ana.user.id,
				expiresAt: new Date(Date.now() - 60_000),
			},
		});
		const revoked = randomUUID();
		await adminDb.magicLink.create({
			data: {
				id: revoked,
				projectId: trip.project.id,
				roleGranted: "VIEWER",
				createdById: trip.ana.user.id,
				isActive: false,
			},
		});
		for (const id of [expired, revoked])
			await expect(
				link(id).sharedPageView({ id: trip.project.id }),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("sharedPageView for a guest", () => {
	it("shows the guest their own balances and the payments", async () => {
		const { guest, token } = await seedGuest(trip, "Gus");
		const caller = anonymousCaller({ "x-guest-token": token });
		const v = await caller.sharedPageView({ id: trip.project.id });
		const me = v.members.find((m) => m.isMe);
		expect(me?.participantId).toBe(guest.id);
		expect(v.payments.length).toBeGreaterThan(0);
		// A guest is in no expense yet: nothing owed either way, never a made-up balance.
		for (const m of v.members) expect(m.withMe).toEqual([]);
		await expect(
			caller.summary({ projectId: trip.project.id }),
		).resolves.toMatchObject({ projectId: trip.project.id });
	});

	it("is refused another project, and an unknown token is refused outright", async () => {
		const { token } = await seedGuest(trip, "Gwen");
		const elsewhere = await seedTrip();
		const guest = anonymousCaller({ "x-guest-token": token });
		await expect(
			guest.sharedPageView({ id: elsewhere.project.id }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			anonymousCaller({ "x-guest-token": randomUUID() }).sharedPageView({
				id: trip.project.id,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("publicPageView", () => {
	it("loads at most one page of rows and still counts and totals everything", async () => {
		const project = await adminDb.project.create({
			data: {
				name: "Big public",
				primaryCurrency: "USD",
				visibility: "PUBLIC",
				createdById: trip.ana.user.id,
			},
		});
		const at = new Date("2026-03-01T12:00:00.000Z");
		await adminDb.sharedTransaction.createMany({
			data: Array.from({ length: PAGE_ROWS + 5 }, (_, i) => ({
				description: `Row ${i}`,
				amount: "2.50",
				currency: "USD",
				date: new Date(at.getTime() + i * 1000),
				paidByType: "user" as const,
				paidById: trip.ana.user.id,
				createdByType: "user" as const,
				createdById: trip.ana.user.id,
				projectId: project.id,
			})),
		});
		const v = await anonymousCaller().publicPageView({ id: project.id });
		expect(v?.expenses).toHaveLength(PAGE_ROWS);
		expect(v?.expenseCount).toBe(PAGE_ROWS + 5);
		// 505 x 2.50
		expect(v?.total).toEqual([{ minor: 126_250, currency: "USD" }]);
		expect(v?.firstExpense).toBe("2026-03-01");
		expect(v?.byCategory.map((c) => c.group)).toEqual([
			[{ minor: 126_250, currency: "USD" }],
		]);
		expect(v?.payments).toEqual([]);
	});

	it("rounds each row to the minor unit before summing, like a member's page", async () => {
		const project = await adminDb.project.create({
			data: {
				name: "Sub-minor",
				primaryCurrency: "USD",
				visibility: "PUBLIC",
				createdById: trip.ana.user.id,
			},
		});
		// 3 x 0.004 USD: each row rounds to 0, so the total is 0.00, not 0.01.
		// 2 x 1.006 USD: each rounds to 1.01, so 2.02. JPY has no minor digits.
		const row = (amount: string, currency: string, i: number) => ({
			description: `Odd ${i}`,
			amount,
			currency,
			date: new Date("2026-03-01T12:00:00.000Z"),
			paidByType: "user" as const,
			paidById: trip.ana.user.id,
			createdByType: "user" as const,
			createdById: trip.ana.user.id,
			projectId: project.id,
		});
		await adminDb.sharedTransaction.createMany({
			data: [
				...["0.004", "0.004", "0.004", "1.006", "1.006"].map((a, i) =>
					row(a, "USD", i),
				),
				...["100.4", "100.4"].map((a, i) => row(a, "JPY", i + 5)),
			],
		});
		const v = await anonymousCaller().publicPageView({ id: project.id });
		expect(v?.total).toEqual([
			{ minor: 200, currency: "JPY" },
			{ minor: 202, currency: "USD" },
		]);
		expect(v?.byCategory.flatMap((c) => c.group)).toEqual(
			expect.arrayContaining([
				{ minor: 202, currency: "USD" },
				{ minor: 200, currency: "JPY" },
			]),
		);
	});

	it("answers one address a limited number of times a minute", async () => {
		const caller = anonymousCaller({ "x-forwarded-for": "203.0.113.77" });
		const id = (
			await adminDb.project.create({
				data: { name: "Quiet", createdById: trip.ana.user.id },
			})
		).id;
		for (let i = 0; i < 60; i++)
			await expect(caller.publicPageView({ id })).resolves.toBeNull();
		await expect(caller.publicPageView({ id })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		});
		// Another address is not slowed down by it.
		await expect(
			anonymousCaller({ "x-forwarded-for": "203.0.113.78" }).publicPageView({
				id,
			}),
		).resolves.toBeNull();
	});
});
