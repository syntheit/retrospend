/**
 * Who may write a split row (split_participant), on Postgres through the
 * scoped client (role retrospend_app, app.current_user_id = the caller).
 *
 * The old policy let any user insert a share for themselves into ANY expense
 * whose id they knew. A split row may now be written only by the expense's
 * creator, a project organizer or editor, or, for a share that already exists,
 * by the person it belongs to. The one way back onto an expense is restoring a
 * share you removed yourself within the undo window.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { ProjectRole } from "~prisma";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser; // creator and payer
let ben: TestUser; // the user who attacks
let cam: TestUser; // an honest participant
let looseId: string; // Ana's expense with no project: Ana and Cam
let projectId: string;
let projectExpenseId: string; // Ana's project expense: Ana and Cam

const RLS = /row-level security/;

async function expense(creator: TestUser, inProject?: string) {
	const made = await adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "100",
			currency: "USD",
			date: new Date("2026-10-10"),
			paidByType: "user",
			paidById: creator.user.id,
			createdByType: "user",
			createdById: creator.user.id,
			projectId: inProject,
			splitParticipants: {
				create: [ana, cam].map((u) => ({
					participantType: "user" as const,
					participantId: u.user.id,
					shareAmount: "50",
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
	return made.id;
}

const share = (user: TestUser, transactionId: string, id?: string) => ({
	id,
	transactionId,
	participantType: "user" as const,
	participantId: user.user.id,
	shareAmount: "10",
});

async function join(user: TestUser, role: ProjectRole) {
	await adminDb.projectParticipant.create({
		data: {
			projectId,
			participantType: "user",
			participantId: user.user.id,
			role,
		},
	});
}

beforeAll(async () => {
	ana = await createTestUser();
	ben = await createTestUser();
	cam = await createTestUser();
	looseId = await expense(ana);
	const project = await adminDb.project.create({
		data: { name: "Trip", createdById: ana.user.id },
	});
	projectId = project.id;
	await join(ana, "ORGANIZER");
	await join(cam, "CONTRIBUTOR");
	projectExpenseId = await expense(ana, projectId);
});

const count = (transactionId: string) =>
	adminDb.splitParticipant.count({ where: { transactionId } });

describe("inserting a share for yourself into someone else's expense", () => {
	it("is refused for an expense outside a project", async () => {
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, looseId) }),
		).rejects.toThrow(RLS);
		expect(await count(looseId)).toBe(2);
	});

	it("is refused for a project expense when you are not in the project", async () => {
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, projectExpenseId) }),
		).rejects.toThrow(RLS);
		expect(await count(projectExpenseId)).toBe(2);
	});

	it("is refused for a project member who is only a viewer or a contributor", async () => {
		const viewer = await createTestUser();
		await join(viewer, "VIEWER");
		await expect(
			viewer.db.splitParticipant.create({
				data: share(viewer, projectExpenseId),
			}),
		).rejects.toThrow(RLS);
		// A contributor may add expenses, but did not create this one.
		const contributor = await createTestUser();
		await join(contributor, "CONTRIBUTOR");
		await expect(
			contributor.db.splitParticipant.createMany({
				data: [share(contributor, projectExpenseId)],
			}),
		).rejects.toThrow(RLS);
		expect(await count(projectExpenseId)).toBe(2);
	});

	it("is refused when the row is someone else's share too", async () => {
		await expect(
			ben.db.splitParticipant.create({ data: share(cam, looseId) }),
		).rejects.toThrow(RLS);
	});

	it("leaves the expense unreadable to the person who tried", async () => {
		await expect(
			ben.db.sharedTransaction.findUnique({ where: { id: looseId } }),
		).resolves.toBeNull();
		await expect(
			ben.db.splitParticipant.findMany({ where: { transactionId: looseId } }),
		).resolves.toEqual([]);
	});
});

describe("moving your own share onto another expense", () => {
	it("is refused", async () => {
		const mine = await expense(ben);
		const target = await expense(ana);
		const bens = await adminDb.splitParticipant.create({
			data: share(ben, mine),
		});
		await expect(
			ben.db.splitParticipant.update({
				where: { id: bens.id },
				data: { transactionId: target },
			}),
		).rejects.toThrow(RLS);
		expect(await count(target)).toBe(2);
	});
});

describe("writes that stay allowed", () => {
	it("lets the creator add, change and remove shares", async () => {
		const id = await expense(ana);
		const bens = await ana.db.splitParticipant.create({ data: share(ben, id) });
		await ana.db.splitParticipant.update({
			where: { id: bens.id },
			data: { shareAmount: "20" },
		});
		await ana.db.splitParticipant.delete({ where: { id: bens.id } });
		expect(await count(id)).toBe(2);
	});

	it("lets a project organizer and editor write another member's expense", async () => {
		const organizer = await createTestUser();
		const editor = await createTestUser();
		await join(organizer, "ORGANIZER");
		await join(editor, "EDITOR");
		for (const who of [organizer, editor]) {
			const created = await who.db.splitParticipant.create({
				data: share(who, projectExpenseId),
			});
			await who.db.splitParticipant.update({
				where: { id: created.id },
				data: { shareAmount: "11" },
			});
			await who.db.splitParticipant.delete({ where: { id: created.id } });
		}
		expect(await count(projectExpenseId)).toBe(2);
	});

	it("lets a participant accept, reject and categorize their own share", async () => {
		const camsShare = await adminDb.splitParticipant.findFirstOrThrow({
			where: { transactionId: looseId, participantId: cam.user.id },
		});
		const rejected = await cam.db.splitParticipant.update({
			where: { id: camsShare.id },
			data: { verificationStatus: "REJECTED", rejectionReason: "Not mine" },
		});
		expect(rejected.verificationStatus).toBe("REJECTED");
		await cam.db.splitParticipant.updateMany({
			where: { transactionId: looseId, participantId: cam.user.id },
			data: { verificationStatus: "ACCEPTED", hasUnseenChanges: false },
		});
	});

	it("keeps another participant's row out of reach of a plain participant", async () => {
		const anasShare = await adminDb.splitParticipant.findFirstOrThrow({
			where: { transactionId: looseId, participantId: ana.user.id },
		});
		const changed = await cam.db.splitParticipant.updateMany({
			where: { id: anasShare.id },
			data: { shareAmount: "0" },
		});
		const removed = await cam.db.splitParticipant.deleteMany({
			where: { id: anasShare.id },
		});
		expect(changed.count + removed.count).toBe(0);
	});

	it("lets a participant remove themselves", async () => {
		const id = await expense(ana);
		const bens = await adminDb.splitParticipant.create({
			data: share(ben, id),
		});
		await ben.db.splitParticipant.deleteMany({ where: { id: bens.id } });
		expect(await count(id)).toBe(2);
	});
});

describe("restoring a share you removed yourself (remove-me undo)", () => {
	async function removedByBen(minutesAgo = 1) {
		const id = await expense(ana);
		const bens = await adminDb.splitParticipant.create({
			data: share(ben, id),
		});
		await adminDb.splitParticipant.delete({ where: { id: bens.id } });
		await adminDb.auditLogEntry.create({
			data: {
				timestamp: new Date(Date.now() - minutesAgo * 60_000),
				actorType: "user",
				actorId: ben.user.id,
				action: "PARTICIPANT_REMOVED",
				targetType: "SPLIT_PARTICIPANT",
				targetId: id,
				changes: {
					participantType: "user",
					participantId: ben.user.id,
					removedSplitIds: [bens.id],
					selfRemoved: true,
				},
			},
		});
		return { id, shareId: bens.id };
	}

	it("puts the same row back", async () => {
		const { id, shareId } = await removedByBen();
		await ben.db.splitParticipant.createMany({
			data: [share(ben, id, shareId)],
		});
		expect(await count(id)).toBe(3);
	});

	it("is refused for a different row id than the one removed", async () => {
		const { id } = await removedByBen();
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, id, randomUUID()) }),
		).rejects.toThrow(RLS);
	});

	it("is refused on another expense than the one removed from", async () => {
		const { shareId } = await removedByBen();
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, looseId, shareId) }),
		).rejects.toThrow(RLS);
	});

	it("is refused after the undo window", async () => {
		const { id, shareId } = await removedByBen(24 * 60 + 5);
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, id, shareId) }),
		).rejects.toThrow(RLS);
	});

	it("is refused for someone else's removal", async () => {
		const { id, shareId } = await removedByBen();
		await expect(
			cam.db.splitParticipant.create({ data: share(cam, id, shareId) }),
		).rejects.toThrow(RLS);
	});

	it("is refused when the owner removed you, not you", async () => {
		const id = await expense(ana);
		const bens = await adminDb.splitParticipant.create({
			data: share(ben, id),
		});
		await ana.db.splitParticipant.delete({ where: { id: bens.id } });
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, id, bens.id) }),
		).rejects.toThrow(RLS);
	});
});

describe("creating an expense", () => {
	const data = (createdBy: TestUser, inProject?: string) => ({
		description: "Taxi",
		amount: "30",
		currency: "USD",
		date: new Date("2026-10-11"),
		paidByType: "user" as const,
		paidById: ben.user.id,
		createdByType: "user" as const,
		createdById: createdBy.user.id,
		projectId: inProject,
	});

	it("is refused in someone else's name, even when you are the payer", async () => {
		await expect(
			ben.db.sharedTransaction.create({ data: data(ana) }),
		).rejects.toThrow(RLS);
	});

	it("is refused in a project you are not in", async () => {
		await expect(
			ben.db.sharedTransaction.create({ data: data(ben, projectId) }),
		).rejects.toThrow(RLS);
	});

	it("works for you, alone or in your project, with its shares in one go", async () => {
		const made = await ben.db.sharedTransaction.create({
			data: {
				...data(ben),
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: cam.user.id,
							shareAmount: "15",
						},
					],
				},
			},
		});
		expect(await count(made.id)).toBe(1);
		await join(ben, "CONTRIBUTOR");
		const inTrip = await ben.db.sharedTransaction.create({
			data: {
				...data(ben, projectId),
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: ben.user.id,
							shareAmount: "30",
						},
					],
				},
			},
		});
		expect(await count(inTrip.id)).toBe(1);
	});
});
