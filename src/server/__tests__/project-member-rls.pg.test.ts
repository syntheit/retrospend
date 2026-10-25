/**
 * Who may write project_participant, and who may move or re-credit an expense
 * (shared_transaction updates), on Postgres through the scoped client.
 *
 * Split-row writes trust project roles, so a role anyone could grant to
 * themselves would undo split-rls.pg.test.ts. The roles: the owner
 * (ORGANIZER) grants and changes anything; an EDITOR manages members up to
 * contributors; a CONTRIBUTOR may add a ghost and edit their own routing; a
 * VIEWER edits only their own routing. Global-client paths (invite links,
 * claims, user deletion) are not subject to RLS and are not tested here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { ProjectRole } from "~prisma";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser; // owner and creator
let eli: TestUser; // editor
let cam: TestUser; // contributor
let vic: TestUser; // viewer
let ben: TestUser; // not in the project
let projectId: string;
let expenseId: string;

const RLS = /row-level security|only the owner|keeps its/;

const member = (user: TestUser) =>
	adminDb.projectParticipant.findFirstOrThrow({
		where: { projectId, participantId: user.user.id },
	});
const roleOf = async (user: TestUser) => (await member(user)).role;
const ghost = async () =>
	(
		await adminDb.shadowProfile.create({
			data: { createdById: ana.user.id, name: "Sam" },
		})
	).id;
const add = (
	who: TestUser,
	user: TestUser,
	role: ProjectRole,
	type: "user" | "shadow" = "user",
	id = user.user.id,
) =>
	who.db.projectParticipant.create({
		data: { projectId, participantType: type, participantId: id, role },
	});

beforeAll(async () => {
	ana = await createTestUser();
	eli = await createTestUser();
	cam = await createTestUser();
	vic = await createTestUser();
	ben = await createTestUser();
	const project = await adminDb.project.create({
		data: { name: "Trip", createdById: ana.user.id },
	});
	projectId = project.id;
	for (const [user, role] of [
		[ana, "ORGANIZER"],
		[eli, "EDITOR"],
		[cam, "CONTRIBUTOR"],
		[vic, "VIEWER"],
	] as const) {
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "user",
				participantId: user.user.id,
				role,
			},
		});
	}
	const made = await adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "100",
			currency: "USD",
			date: new Date("2026-10-10"),
			paidByType: "user",
			paidById: ana.user.id,
			createdByType: "user",
			createdById: ana.user.id,
			projectId,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: ana.user.id,
						shareAmount: "100",
					},
				],
			},
		},
	});
	expenseId = made.id;
});

describe("someone outside the project", () => {
	it("cannot join it, whatever the role", async () => {
		for (const role of ["ORGANIZER", "VIEWER"] as const) {
			await expect(add(ben, ben, role)).rejects.toThrow(RLS);
		}
	});

	it("cannot then write a split row or remove the owner", async () => {
		await expect(
			ben.db.splitParticipant.create({
				data: {
					transactionId: expenseId,
					participantType: "user",
					participantId: ben.user.id,
					shareAmount: "-100",
				},
			}),
		).rejects.toThrow(RLS);
		const removed = await ben.db.projectParticipant.deleteMany({
			where: { projectId, participantId: ana.user.id },
		});
		expect(removed.count).toBe(0);
	});

	it("cannot add anyone else either", async () => {
		await expect(add(ben, cam, "VIEWER")).rejects.toThrow(RLS);
		await expect(
			add(ben, ben, "CONTRIBUTOR", "shadow", await ghost()),
		).rejects.toThrow(RLS);
	});
});

describe("a member cannot raise their own role", () => {
	it.each([
		["contributor", () => cam],
		["viewer", () => vic],
		["editor", () => eli],
	])("%s to owner", async (_name, who) => {
		await expect(
			who().db.projectParticipant.updateMany({
				where: { projectId, participantId: who().user.id },
				data: { role: "ORGANIZER" },
			}),
		).rejects.toThrow(RLS);
		expect(await roleOf(who())).not.toBe("ORGANIZER");
	});

	it("contributor to editor", async () => {
		await expect(
			cam.db.projectParticipant.updateMany({
				where: { projectId, participantId: cam.user.id },
				data: { role: "EDITOR" },
			}),
		).rejects.toThrow(RLS);
	});
});

describe("own row, non-role fields", () => {
	it.each([
		["contributor", () => cam],
		["viewer", () => vic],
	])("a %s may change their own routing and analytics switch", async (_n, who) => {
		const done = await who().db.projectParticipant.updateMany({
			where: { projectId, participantId: who().user.id },
			data: { excludeFromAnalytics: true, budgetRouting: "NOT_IN_BUDGET" },
		});
		expect(done.count).toBe(1);
	});

	it("but not their join date, leave date or place", async () => {
		for (const data of [
			{ joinedOn: new Date("2020-01-01") },
			{ leftOn: new Date("2030-01-01") },
			{ participantId: ben.user.id },
		]) {
			await expect(
				cam.db.projectParticipant.updateMany({
					where: { projectId, participantId: cam.user.id },
					data,
				}),
			).rejects.toThrow(RLS);
		}
	});
});

describe("an editor", () => {
	it("cannot make an owner, in either direction", async () => {
		await expect(add(eli, ben, "ORGANIZER")).rejects.toThrow(RLS);
		await expect(
			eli.db.projectParticipant.updateMany({
				where: { projectId, participantId: cam.user.id },
				data: { role: "ORGANIZER" },
			}),
		).rejects.toThrow(RLS);
		expect(await roleOf(cam)).toBe("CONTRIBUTOR");
	});

	it("cannot change or remove an owner", async () => {
		await expect(
			eli.db.projectParticipant.updateMany({
				where: { projectId, participantId: ana.user.id },
				data: { role: "VIEWER" },
			}),
		).rejects.toThrow(RLS);
		await expect(
			eli.db.projectParticipant.updateMany({
				where: { projectId, participantId: ana.user.id },
				data: { leftOn: new Date("2030-01-01") },
			}),
		).rejects.toThrow(RLS);
		const removed = await eli.db.projectParticipant.deleteMany({
			where: { projectId, participantId: ana.user.id },
		});
		expect(removed.count).toBe(0);
	});

	it("adds, promotes up to editor, and removes members", async () => {
		const newcomer = await createTestUser();
		await add(eli, newcomer, "CONTRIBUTOR");
		const promoted = await eli.db.projectParticipant.updateMany({
			where: { projectId, participantId: newcomer.user.id },
			data: { role: "EDITOR", joinedOn: new Date("2026-10-01") },
		});
		expect(promoted.count).toBe(1);
		const removed = await eli.db.projectParticipant.deleteMany({
			where: { projectId, participantId: newcomer.user.id },
		});
		expect(removed.count).toBe(1);
	});
});

describe("below an editor", () => {
	it("a contributor or viewer cannot remove or edit anyone else", async () => {
		for (const who of [cam, vic]) {
			const removed = await who.db.projectParticipant.deleteMany({
				where: { projectId, participantId: eli.user.id },
			});
			const edited = await who.db.projectParticipant.updateMany({
				where: { projectId, participantId: eli.user.id },
				data: { excludeFromAnalytics: true },
			});
			expect(removed.count + edited.count).toBe(0);
			await expect(add(who, ben, "VIEWER")).rejects.toThrow(RLS);
		}
	});

	it("a contributor adds a ghost as a contributor, nothing else", async () => {
		await add(cam, cam, "CONTRIBUTOR", "shadow", await ghost());
		await expect(
			add(cam, cam, "EDITOR", "shadow", await ghost()),
		).rejects.toThrow(RLS);
		await expect(
			add(vic, vic, "CONTRIBUTOR", "shadow", await ghost()),
		).rejects.toThrow(RLS);
	});
});

describe("the owner", () => {
	it("adds an owner, changes roles and hands the project over", async () => {
		const newcomer = await createTestUser();
		await add(ana, newcomer, "ORGANIZER");
		await ana.db.projectParticipant.updateMany({
			where: { projectId, participantId: newcomer.user.id },
			data: { role: "VIEWER" },
		});
		expect(await roleOf(newcomer)).toBe("VIEWER");
		// Transfer: promote the new owner first, then step down, then re-credit.
		const second = await adminDb.project.create({
			data: { name: "Second", createdById: ana.user.id },
		});
		for (const [user, role] of [
			[ana, "ORGANIZER"],
			[eli, "EDITOR"],
		] as const) {
			await adminDb.projectParticipant.create({
				data: {
					projectId: second.id,
					participantType: "user",
					participantId: user.user.id,
					role,
				},
			});
		}
		await ana.db.$transaction(async (tx) => {
			await tx.projectParticipant.updateMany({
				where: { projectId: second.id, participantId: eli.user.id },
				data: { role: "ORGANIZER" },
			});
			await tx.projectParticipant.updateMany({
				where: { projectId: second.id, participantId: ana.user.id },
				data: { role: "EDITOR" },
			});
			await tx.project.update({
				where: { id: second.id },
				data: { createdById: eli.user.id },
			});
		});
	});

	it("creates a project and joins it as its owner", async () => {
		const mine = await ben.db.project.create({
			data: { name: "Ben's", createdById: ben.user.id },
		});
		await ben.db.projectParticipant.create({
			data: {
				projectId: mine.id,
				participantType: "user",
				participantId: ben.user.id,
				role: "ORGANIZER",
			},
		});
		// A project that is not yours cannot be claimed the same way.
		await expect(
			ben.db.projectParticipant.create({
				data: {
					projectId,
					participantType: "user",
					participantId: ben.user.id,
					role: "ORGANIZER",
				},
			}),
		).rejects.toThrow(RLS);
	});
});

describe("moving or re-crediting an expense", () => {
	const mine = () =>
		adminDb.sharedTransaction.create({
			data: {
				description: "Mine",
				amount: "10",
				currency: "USD",
				date: new Date("2026-10-10"),
				paidByType: "user",
				paidById: ben.user.id,
				createdByType: "user",
				createdById: ben.user.id,
			},
		});

	it("cannot put your expense into a project you are not in", async () => {
		const row = await mine();
		const other = await adminDb.project.create({
			data: { name: "Other", createdById: ana.user.id },
		});
		await expect(
			ben.db.sharedTransaction.update({
				where: { id: row.id },
				data: { projectId: other.id },
			}),
		).rejects.toThrow(RLS);
	});

	it("can move it into a project you are in, and edit it", async () => {
		const row = await mine();
		const own = await ben.db.project.create({
			data: { name: "Own", createdById: ben.user.id },
		});
		await ben.db.projectParticipant.create({
			data: {
				projectId: own.id,
				participantType: "user",
				participantId: ben.user.id,
				role: "ORGANIZER",
			},
		});
		const moved = await ben.db.sharedTransaction.update({
			where: { id: row.id },
			data: { projectId: own.id, description: "Moved" },
		});
		expect(moved.projectId).toBe(own.id);
	});

	it("cannot hand the expense to someone else as its creator", async () => {
		const row = await mine();
		await expect(
			ben.db.sharedTransaction.update({
				where: { id: row.id },
				data: { createdById: ana.user.id },
			}),
		).rejects.toThrow(RLS);
		await expect(
			adminDb.sharedTransaction.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ createdById: ben.user.id });
	});
});
