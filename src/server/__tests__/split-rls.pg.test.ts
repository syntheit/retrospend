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

describe("changing your own share", () => {
	it("lets you change only the review columns", async () => {
		const id = await expense(ana);
		const mine = await adminDb.splitParticipant.create({ data: share(ben, id) });
		const category = await adminDb.category.create({
			data: { name: "Food", color: "blue", userId: ben.user.id },
		});
		const updated = await ben.db.splitParticipant.update({
			where: { id: mine.id },
			data: {
				verificationStatus: "ACCEPTED",
				verifiedAt: new Date(),
				rejectionReason: null,
				hasUnseenChanges: true,
				categoryId: category.id,
				categorySource: "USER",
			},
		});
		expect(updated.categoryId).toBe(category.id);
	});

	it.each([
		["the amount", { shareAmount: "0" }],
		["the percentage", { sharePercentage: "1" }],
		["the units", { shareUnits: 9 }],
		["whose share it is", { participantId: "someone-else" }],
	])("refuses changing %s", async (_name, data) => {
		const id = await expense(ana);
		const mine = await adminDb.splitParticipant.create({ data: share(ben, id) });
		await expect(
			ben.db.splitParticipant.update({ where: { id: mine.id }, data }),
		).rejects.toThrow(RLS);
		await expect(
			adminDb.splitParticipant.findUniqueOrThrow({ where: { id: mine.id } }),
		).resolves.toMatchObject({ shareAmount: mine.shareAmount });
	});

	it("lets the creator change the amount", async () => {
		const id = await expense(ana);
		const mine = await adminDb.splitParticipant.create({ data: share(ben, id) });
		await ana.db.splitParticipant.update({
			where: { id: mine.id },
			data: { shareAmount: "12" },
		});
	});
});

describe("restoring a share you removed yourself (remove-me undo)", () => {
	const records = (shareId: string) =>
		adminDb.$queryRawUnsafe<{ n: number }[]>(
			`SELECT count(*)::int AS n FROM split_participant_removal WHERE "splitId" = $1`,
			shareId,
		);

	// Ben is on Ana's expense with a 25% share and removes himself, as the app does.
	async function removedByBen() {
		const id = await expense(ana);
		const row = await adminDb.splitParticipant.create({
			data: {
				...share(ben, id),
				sharePercentage: "25",
				verificationStatus: "ACCEPTED",
			},
		});
		await ben.db.splitParticipant.deleteMany({ where: { id: row.id } });
		const back = (over: Record<string, unknown> = {}) => ({
			id: row.id,
			transactionId: id,
			participantType: "user" as const,
			participantId: ben.user.id,
			shareAmount: row.shareAmount,
			sharePercentage: row.sharePercentage,
			shareUnits: row.shareUnits,
			verificationStatus: row.verificationStatus,
			...over,
		});
		return { id, row, back };
	}

	it("puts the same row back once, and uses up the record", async () => {
		const { id, row, back } = await removedByBen();
		expect((await records(row.id))[0]?.n).toBe(1);
		await ben.db.splitParticipant.createMany({ data: [back()] });
		expect(await count(id)).toBe(3);
		expect((await records(row.id))[0]?.n).toBe(0);
	});

	it("does not work a second time after the owner removes the row", async () => {
		const { row, back } = await removedByBen();
		await ben.db.splitParticipant.createMany({ data: [back()] });
		await ana.db.splitParticipant.delete({ where: { id: row.id } });
		await expect(
			ben.db.splitParticipant.create({ data: back() }),
		).rejects.toThrow(RLS);
	});

	it.each([
		["a different row id", { id: randomUUID() }],
		["a negative amount", { shareAmount: "-500" }],
		["a bigger amount", { shareAmount: "11" }],
		["another percentage", { sharePercentage: "50" }],
		["other units", { shareUnits: 3 }],
		["another status", { verificationStatus: "PENDING" }],
	])("is refused with %s", async (_name, over) => {
		const { back } = await removedByBen();
		await expect(
			ben.db.splitParticipant.create({ data: back(over) }),
		).rejects.toThrow(RLS);
	});

	it("is refused on another expense than the one removed from", async () => {
		const { back } = await removedByBen();
		await expect(
			ben.db.splitParticipant.create({
				data: back({ transactionId: looseId }),
			}),
		).rejects.toThrow(RLS);
	});

	it("is refused after the undo window", async () => {
		const { row, back } = await removedByBen();
		await adminDb.$executeRawUnsafe(
			`UPDATE split_participant_removal SET "removedAt" = now() - interval '25 hours' WHERE "splitId" = $1`,
			row.id,
		);
		await expect(
			ben.db.splitParticipant.create({ data: back() }),
		).rejects.toThrow(RLS);
	});

	it("is refused for someone else's removal", async () => {
		const { back } = await removedByBen();
		await expect(
			cam.db.splitParticipant.create({
				data: back({ participantId: cam.user.id }),
			}),
		).rejects.toThrow(RLS);
	});

	it("is refused when the owner removed you, not you", async () => {
		const id = await expense(ana);
		const row = await adminDb.splitParticipant.create({ data: share(ben, id) });
		await ana.db.splitParticipant.delete({ where: { id: row.id } });
		expect((await records(row.id))[0]?.n).toBe(0);
		await expect(
			ben.db.splitParticipant.create({ data: share(ben, id, row.id) }),
		).rejects.toThrow(RLS);
	});

	it("is refused when a forged audit entry is the only proof", async () => {
		const id = await expense(ana);
		const rowId = randomUUID();
		const forged = ben.db.auditLogEntry.create({
			data: {
				actorType: "user",
				actorId: ben.user.id,
				action: "PARTICIPANT_REMOVED",
				targetType: "SPLIT_PARTICIPANT",
				targetId: id,
				changes: { removedSplitIds: [rowId], selfRemoved: true },
			},
		});
		await forged.catch(() => undefined);
		await expect(
			ben.db.splitParticipant.create({
				data: share(ben, id, rowId),
			}),
		).rejects.toThrow(RLS);
	});
});

describe("the audit log", () => {
	const entry = (actorId: string) => ({
		actorType: "user" as const,
		actorId,
		action: "EDITED" as const,
		targetType: "SHARED_TRANSACTION" as const,
		targetId: "anything",
	});

	it("takes your own entries", async () => {
		await ben.db.auditLogEntry.create({ data: entry(ben.user.id) });
	});

	it("refuses an entry in someone else's name", async () => {
		await expect(
			ben.db.auditLogEntry.create({ data: entry(ana.user.id) }),
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
