/**
 * Characterization of the project router's write procedures on a real
 * Postgres, written before their logic moved out of routers/project.ts.
 * Each test seeds its own trip, so writes never leak between tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { callerFor, namedUser, seedTrip } from "./trip-fixture";

const sendEmail = vi.hoisted(() => vi.fn(async () => {}));
const createNotification = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("~/server/mailer", () => ({ sendEmail }));
vi.mock("~/server/services/notifications", () => ({
	createNotification,
	resolveParticipantName: vi.fn(async () => "Ana"),
}));

beforeEach(() => {
	sendEmail.mockClear();
	createNotification.mockClear();
});

const auditFor = (projectId: string, action: string) =>
	adminDb.auditLogEntry.findMany({
		where: { projectId, action: action as never },
		orderBy: { timestamp: "asc" },
	});

const memberRole = async (
	projectId: string,
	participantType: "user" | "shadow" | "guest",
	participantId: string,
) =>
	(
		await adminDb.projectParticipant.findUnique({
			where: {
				projectId_participantType_participantId: {
					projectId,
					participantType,
					participantId,
				},
			},
		})
	)?.role ?? null;

describe("project.create", () => {
	it("creates the project with its creator as owner and a first period", async () => {
		const ana = await namedUser("Ana");
		const p = await callerFor(ana.user).create({
			name: "Depto",
			primaryCurrency: "ARS",
			budgetAmount: 500000,
			budgetCurrency: "ARS",
			billingCycleLength: "MONTHLY",
		});
		expect(p).toMatchObject({
			name: "Depto",
			description: null,
			primaryCurrency: "ARS",
			visibility: "PRIVATE",
			createdById: ana.user.id,
			billingCycleLength: "MONTHLY",
			billingAutoClose: false,
			billingCloseReminderDays: 3,
			billingClosePermission: "ORGANIZER_ONLY",
		});
		expect(p.budgetAmount?.toString()).toBe("500000");
		expect(p.participants.map((x) => [x.participantId, x.role])).toEqual([
			[ana.user.id, "ORGANIZER"],
		]);
		expect(p.billingPeriods).toHaveLength(1);
		expect(p.billingPeriods[0]?.status).toBe("OPEN");
		const audits = await auditFor(p.id, "CREATED");
		expect(audits.map((a) => [a.targetType, a.changes])).toEqual([
			["PROJECT", { name: "Depto" }],
		]);
	});

	it("opens no period without a billing cycle", async () => {
		const ana = await namedUser("Ana");
		const p = await callerFor(ana.user).create({ name: "Trip" });
		expect(p).toMatchObject({ primaryCurrency: "USD", billingPeriods: [] });
	});
});

describe("project.update", () => {
	it("writes only the changed fields and audits the diff", async () => {
		const trip = await seedTrip();
		const updated = await callerFor(trip.ben.user).update({
			id: trip.project.id,
			name: "Floripa 2026",
			description: "Beach week",
			visibility: "PRIVATE",
		});
		expect(updated).toMatchObject({
			name: "Floripa 2026",
			visibility: "PRIVATE",
		});
		const [audit] = await auditFor(trip.project.id, "EDITED");
		expect(audit?.changes).toEqual({
			name: { old: trip.project.name, new: "Floripa 2026" },
			visibility: { old: "PUBLIC", new: "PRIVATE" },
		});
	});

	it("returns the row untouched when nothing changed", async () => {
		const trip = await seedTrip();
		const same = await callerFor(trip.ana.user).update({
			id: trip.project.id,
			name: trip.project.name,
		});
		expect(same.updatedAt).toEqual(trip.project.updatedAt);
		await expect(auditFor(trip.project.id, "EDITED")).resolves.toEqual([]);
	});

	it("opens a first period when billing is turned on", async () => {
		const trip = await seedTrip();
		await callerFor(trip.ana.user).update({
			id: trip.project.id,
			billingCycleLength: "WEEKLY",
		});
		const periods = await adminDb.billingPeriod.findMany({
			where: { projectId: trip.project.id },
		});
		expect(periods.map((p) => p.status)).toEqual(["OPEN"]);
	});

	it("needs an editor", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.cam.user).update({ id: trip.project.id, name: "X" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("project.updateAnalyticsExclusion", () => {
	it("sets my own flag only", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.cam.user).updateAnalyticsExclusion({
				projectId: trip.project.id,
				exclude: true,
			}),
		).resolves.toEqual({ excludeFromAnalytics: true });
		const rows = await adminDb.projectParticipant.findMany({
			where: { projectId: trip.project.id, excludeFromAnalytics: true },
		});
		expect(rows.map((r) => r.participantId)).toEqual([trip.cam.user.id]);
		await expect(
			callerFor(trip.outsider.user).updateAnalyticsExclusion({
				projectId: trip.project.id,
				exclude: true,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("project.addParticipant", () => {
	it("adds a user, audits it and notifies them", async () => {
		const trip = await seedTrip();
		const p = await callerFor(trip.ana.user).addParticipant({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
		});
		expect(p).toMatchObject({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
			role: "CONTRIBUTOR",
		});
		const [audit] = await auditFor(trip.project.id, "PARTICIPANT_ADDED");
		expect(audit?.changes).toEqual({
			participantType: "user",
			participantId: trip.outsider.user.id,
			role: "CONTRIBUTOR",
		});
		await vi.waitFor(() => expect(createNotification).toHaveBeenCalled());
		expect(createNotification).toHaveBeenCalledWith({
			userId: trip.outsider.user.id,
			type: "PARTICIPANT_ADDED",
			title: "Added to project",
			body: `Ana added you to '${trip.project.name}'`,
			data: { projectId: trip.project.id },
		});
	});

	it("caps a ghost at contributor and emails a one-use invite", async () => {
		const trip = await seedTrip();
		const ghost = await adminDb.shadowProfile.create({
			data: {
				createdById: trip.ana.user.id,
				name: "Gil",
				email: "gil@pg-test.invalid",
			},
		});
		const p = await callerFor(trip.ana.user).addParticipant({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: ghost.id,
			role: "EDITOR",
		});
		expect(p.role).toBe("CONTRIBUTOR");
		const links = await adminDb.magicLink.findMany({
			where: { projectId: trip.project.id },
		});
		expect(links.map((l) => [l.roleGranted, l.maxUses])).toEqual([
			["CONTRIBUTOR", 1],
		]);
		await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
		const [to, subject] = sendEmail.mock.calls[0] as unknown as [
			string,
			string,
		];
		expect([to, subject]).toEqual([
			"gil@pg-test.invalid",
			"Retrospend: You've been added to a project",
		]);
	});

	it("refuses duplicates, foreign ghosts and an editor making an owner", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.ana.user).addParticipant({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.ben.user.id,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const foreign = await adminDb.shadowProfile.create({
			data: { createdById: trip.ben.user.id, name: "Bo" },
		});
		await expect(
			callerFor(trip.ana.user).addParticipant({
				projectId: trip.project.id,
				participantType: "shadow",
				participantId: foreign.id,
			}),
			// RLS hides another user's ghost, so this is NOT_FOUND before the owner check.
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			callerFor(trip.ben.user).addParticipant({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.outsider.user.id,
				role: "ORGANIZER",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("project.rebalanceExpenses", () => {
	it("re-splits the chosen equal expense with the newcomer", async () => {
		const trip = await seedTrip();
		const olga = trip.outsider.user.id;
		await adminDb.projectParticipant.create({
			data: {
				projectId: trip.project.id,
				participantType: "user",
				participantId: olga,
			},
		});
		const r = await callerFor(trip.ana.user).rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: olga,
			expenseIds: [trip.expenses.hotel.id],
		});
		expect(r).toEqual({
			rebalancedCount: 1,
			skipped: [],
			rebalancedIds: [trip.expenses.hotel.id],
		});
		const rows = await adminDb.splitParticipant.findMany({
			where: { transactionId: trip.expenses.hotel.id },
		});
		const nameOf = new Map([
			[trip.ana.user.id, "Ana"],
			[trip.ben.user.id, "Ben"],
			[trip.cam.user.id, "Cam"],
			[olga, "Olga"],
		]);
		expect(
			rows
				.map((s) => [
					nameOf.get(s.participantId),
					s.shareAmount.toString(),
					s.verificationStatus,
					s.hasUnseenChanges,
				])
				.sort(),
		).toEqual([
			["Ana", "75", "ACCEPTED", false],
			["Ben", "75", "AUTO_ACCEPTED", true],
			["Cam", "75", "AUTO_ACCEPTED", true],
			["Olga", "75", "AUTO_ACCEPTED", true],
		]);
	});

	it("skips locked and non-equal expenses when none are chosen", async () => {
		const trip = await seedTrip();
		const r = await callerFor(trip.ana.user).rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: trip.sam.id,
		});
		expect(r.rebalancedCount).toBe(1);
		expect(r.rebalancedIds).toEqual([trip.expenses.hotel.id]);
		const reasons = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
		expect(reasons).toEqual({
			[trip.expenses.car.id]: "already_included",
			[trip.expenses.boat.id]: "non_equal_split",
			[trip.expenses.dinner.id]: "locked",
		});
	});

	it("needs the person to be a member", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.ana.user).rebalanceExpenses({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.outsider.user.id,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("project.updateParticipantRole", () => {
	it("changes a role, caps ghosts, and audits", async () => {
		const trip = await seedTrip();
		const updated = await callerFor(trip.ana.user).updateParticipantRole({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.cam.user.id,
			role: "EDITOR",
		});
		expect(updated.role).toBe("EDITOR");
		const ghost = await callerFor(trip.ana.user).updateParticipantRole({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: trip.sam.id,
			role: "ORGANIZER",
		});
		expect(ghost.role).toBe("CONTRIBUTOR");
		const audits = await auditFor(trip.project.id, "ROLE_CHANGED");
		expect(audits.map((a) => a.changes)).toEqual([
			{
				participantType: "user",
				participantId: trip.cam.user.id,
				oldRole: "CONTRIBUTOR",
				newRole: "EDITOR",
			},
			{
				participantType: "shadow",
				participantId: trip.sam.id,
				oldRole: "CONTRIBUTOR",
				newRole: "CONTRIBUTOR",
			},
		]);
	});

	it("refuses my own role, demoting the creator, and an editor touching an owner", async () => {
		const trip = await seedTrip();
		const call = (
			who: typeof trip.ana,
			id: string,
			role: "VIEWER" | "ORGANIZER",
		) =>
			callerFor(who.user).updateParticipantRole({
				projectId: trip.project.id,
				participantType: "user",
				participantId: id,
				role,
			});
		await expect(
			call(trip.ana, trip.ana.user.id, "VIEWER"),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			call(trip.ben, trip.ana.user.id, "VIEWER"),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			call(trip.ben, trip.cam.user.id, "ORGANIZER"),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});

describe("project.transferOwnership", () => {
	it("swaps the owner and editor roles and notifies the new owner", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.ana.user).transferOwnership({
				projectId: trip.project.id,
				newOwnerParticipantId: trip.ben.user.id,
				confirmProjectName: trip.project.name,
			}),
		).resolves.toEqual({ success: true });
		const project = await adminDb.project.findUniqueOrThrow({
			where: { id: trip.project.id },
		});
		expect(project.createdById).toBe(trip.ben.user.id);
		await expect(
			memberRole(trip.project.id, "user", trip.ben.user.id),
		).resolves.toBe("ORGANIZER");
		await expect(
			memberRole(trip.project.id, "user", trip.ana.user.id),
		).resolves.toBe("EDITOR");
		await vi.waitFor(() =>
			expect(createNotification).toHaveBeenCalledWith({
				userId: trip.ben.user.id,
				type: "PARTICIPANT_ADDED",
				title: "Ownership transferred",
				body: `Ana transferred ownership of "${trip.project.name}" to you.`,
				data: { projectId: trip.project.id },
			}),
		);
	});

	it("needs the exact project name and a user member", async () => {
		const trip = await seedTrip();
		const call = (id: string, name: string) =>
			callerFor(trip.ana.user).transferOwnership({
				projectId: trip.project.id,
				newOwnerParticipantId: id,
				confirmProjectName: name,
			});
		await expect(call(trip.ben.user.id, "nope")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(
			call(trip.outsider.user.id, trip.project.name),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			call(trip.ana.user.id, trip.project.name),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});

describe("project.removeParticipant", () => {
	it("removes a member and audits it, never the creator", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.ana.user).removeParticipant({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.cam.user.id,
			}),
		).resolves.toEqual({ success: true });
		await expect(
			memberRole(trip.project.id, "user", trip.cam.user.id),
		).resolves.toBeNull();
		const [audit] = await auditFor(trip.project.id, "PARTICIPANT_REMOVED");
		expect(audit?.changes).toEqual({
			participantType: "user",
			participantId: trip.cam.user.id,
		});
		await expect(
			callerFor(trip.ben.user).removeParticipant({
				projectId: trip.project.id,
				participantType: "user",
				participantId: trip.ana.user.id,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("project.delete", () => {
	it("lets only the creator delete", async () => {
		const trip = await seedTrip();
		await adminDb.projectParticipant.update({
			where: {
				projectId_participantType_participantId: {
					projectId: trip.project.id,
					participantType: "user",
					participantId: trip.ben.user.id,
				},
			},
			data: { role: "ORGANIZER" },
		});
		await expect(
			callerFor(trip.ben.user).delete({ id: trip.project.id }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			callerFor(trip.ana.user).delete({ id: trip.project.id }),
		).resolves.toEqual({ success: true });
		await expect(
			adminDb.project.findUnique({ where: { id: trip.project.id } }),
		).resolves.toBeNull();
	});
});

describe("magic links", () => {
	it("creates one active link per role and reuses it", async () => {
		const trip = await seedTrip();
		const pid = trip.project.id;
		const first = await callerFor(trip.ben.user).createMagicLink({
			projectId: pid,
			roleGranted: "VIEWER",
		});
		expect(first.url.endsWith(`/projects/${pid}?invite=${first.id}`)).toBe(
			true,
		);
		const again = await callerFor(trip.ben.user).createMagicLink({
			projectId: pid,
			roleGranted: "VIEWER",
		});
		expect(again.id).toBe(first.id);
		await expect(
			callerFor(trip.ben.user).createMagicLink({
				projectId: pid,
				roleGranted: "ORGANIZER",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const [audit] = await auditFor(pid, "CREATED");
		expect(audit?.changes).toEqual({ linkId: first.id, roleGranted: "VIEWER" });
	});

	it("lists, revokes and resets links", async () => {
		const trip = await seedTrip();
		const pid = trip.project.id;
		const ben = callerFor(trip.ben.user);
		const viewer = await ben.createMagicLink({
			projectId: pid,
			roleGranted: "VIEWER",
		});
		const editor = await ben.createMagicLink({
			projectId: pid,
			roleGranted: "EDITOR",
		});
		const listed = await ben.listMagicLinks({ projectId: pid });
		expect(listed.map((l) => l.id).sort()).toEqual(
			[viewer.id, editor.id].sort(),
		);

		const revoked = await ben.revokeMagicLink({
			projectId: pid,
			linkId: viewer.id,
		});
		expect(revoked.isActive).toBe(false);
		await expect(
			ben.revokeMagicLink({ projectId: "elsewhere", linkId: editor.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		const reset = await ben.resetMagicLink({ projectId: pid, role: "EDITOR" });
		expect(reset.id).not.toBe(editor.id);
		expect(reset.url.endsWith(`?invite=${reset.id}`)).toBe(true);
		const active = await ben.listMagicLinks({ projectId: pid });
		expect(active.map((l) => [l.id, l.roleGranted])).toEqual([
			[reset.id, "EDITOR"],
		]);
		await expect(
			ben.resetMagicLink({ projectId: pid, role: "ORGANIZER" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			callerFor(trip.cam.user).listMagicLinks({ projectId: pid }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
