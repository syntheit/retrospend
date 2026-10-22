/**
 * Who can read and change a project, on Postgres: anonymous viewer links,
 * members with the VIEWER role, and guests whose token is for another
 * project.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	addMember,
	anonymousCaller,
	callerFor,
	seedGuest,
	seedTrip,
	type Trip,
} from "./trip-fixture";

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
	await addMember(trip.project.id, "user", trip.outsider.user.id, "VIEWER");
});

describe("an anonymous viewer link", () => {
	const link = () => anonymousCaller({ "x-viewer-link-id": viewerLinkId });

	it("reads the project as a viewer and sees no emails", async () => {
		const d = await link().detail({ id: trip.project.id });
		expect(d).toMatchObject({
			myRole: "VIEWER",
			myParticipantType: "viewerLink",
			unseenChangesCount: 0,
		});
		expect(d.participants.every((p) => p.email === null)).toBe(true);
	});

	it("lists expenses with nothing editable", async () => {
		const r = await link().listExpenses({ projectId: trip.project.id });
		expect(r.total).toBe(4);
		expect(r.transactions.some((t) => t.canEdit || t.canDelete)).toBe(false);
	});

	it("reads the summary and the plan", async () => {
		const s = await link().summary({ projectId: trip.project.id });
		expect(s.total).toEqual([
			{ minor: 45000, currency: "BRL" },
			{ minor: 5000, currency: "USD" },
		]);
		const plan = await link().settlementPlan({ projectId: trip.project.id });
		expect(plan.participantCount).toBe(4);
	});

	it("is refused for another project and for any write", async () => {
		const other = await adminDb.project.create({
			data: { name: "Other", createdById: trip.ana.user.id },
		});
		await expect(link().detail({ id: other.id })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			link().update({ id: trip.project.id, name: "Mine now" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("a member with the VIEWER role", () => {
	const olga = () => callerFor(trip.outsider.user);

	it("reads but can edit nothing", async () => {
		const d = await olga().detail({ id: trip.project.id });
		expect(d.myRole).toBe("VIEWER");
		const r = await olga().listExpenses({ projectId: trip.project.id });
		expect(r.transactions.some((t) => t.canEdit || t.canDelete)).toBe(false);
		const s = await olga().summary({ projectId: trip.project.id });
		expect(s.balancesAddUp).toBe(true);
	});

	it("is refused editor actions", async () => {
		await expect(
			olga().update({ id: trip.project.id, name: "X" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			olga().rebalanceableExpenses({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.cam.user.id,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			olga().setMembershipDates({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.cam.user.id,
				joinedOn: "2026-10-10",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("a guest of another project", () => {
	it("is refused before any read", async () => {
		const elsewhere = await seedTrip();
		const { token } = await seedGuest(elsewhere, "Gus");
		const guest = anonymousCaller({ "x-guest-token": token });
		for (const call of [
			() => guest.detail({ id: trip.project.id }),
			() => guest.listExpenses({ projectId: trip.project.id }),
			() => guest.summary({ projectId: trip.project.id }),
			() => guest.membersOn({ projectId: trip.project.id, date: "2026-10-10" }),
		]) {
			await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
	});
});
