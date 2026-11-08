/**
 * The admin access log on real Postgres (RLS on): an admin acting on a person
 * writes one row with the global connection, the person reads only their own
 * rows through the user-scoped connection, and the person cannot add, change
 * or delete a row. A missing person is NOT_FOUND and nothing is written, and
 * an action the procedure refuses or fails to validate leaves no entry.
 */
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { adminAccessRouter } from "~/server/api/routers/admin-access";
import { adminRouter } from "~/server/api/routers/admin";
import { createCallerFactory } from "~/server/api/trpc";
import { LastAdminError } from "~/server/services/admin-guard.service";
import { recordAdminAccess } from "~/server/services/admin-access.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";

type Made = Awaited<ReturnType<typeof createTestUser>>;

const asAdmin = (u: Made) =>
	createCallerFactory(adminRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name, role: "ADMIN" }),
		db: u.db,
		headers: new Headers(),
	});

const asUser = (u: Made) =>
	createCallerFactory(adminAccessRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name, role: "USER" }),
		db: u.db,
		headers: new Headers(),
	});

describe("admin access log", () => {
	let admin: Made;
	let bob: Made;
	let eve: Made;

	beforeAll(async () => {
		admin = await createTestUser({ role: "ADMIN" });
		bob = await createTestUser();
		eve = await createTestUser();
	});

	it("records an admin action on bob and shows it to bob only", async () => {
		await asAdmin(admin).setUserAiAccess({
			userId: bob.user.id,
			externalAiAllowed: false,
		});

		const rows = await asUser(bob).list();
		expect(rows.map((r) => r.action)).toEqual(["ai_access_changed"]);
		expect(await asUser(eve).list()).toEqual([]);
		expect(
			await adminDb.adminAccessLog.count({ where: { userId: bob.user.id } }),
		).toBe(1);
		const [row] = await adminDb.adminAccessLog.findMany({
			where: { userId: bob.user.id },
		});
		expect(row?.adminId).toBe(admin.user.id);
	});

	it("logs every kind of action on the account, newest first", async () => {
		await asAdmin(admin).disableUser({ userId: eve.user.id });
		await asAdmin(admin).enableUser({ userId: eve.user.id });
		await asAdmin(admin).generatePasswordResetLink({ userId: eve.user.id });

		const rows = await asUser(eve).list();
		expect(rows.map((r) => r.action)).toEqual([
			"reset_link",
			"enabled",
			"disabled",
		]);
	});

	it("keeps the app role from writing, changing or deleting a row", async () => {
		await expect(
			bob.db.adminAccessLog.create({
				data: { userId: bob.user.id, adminId: bob.user.id, action: "forged" },
			}),
		).rejects.toThrow();
		await expect(
			bob.db.adminAccessLog.updateMany({
				where: { userId: bob.user.id },
				data: { action: "edited" },
			}),
		).rejects.toThrow();
		await expect(
			bob.db.adminAccessLog.deleteMany({ where: { userId: bob.user.id } }),
		).rejects.toThrow();
		expect(
			await adminDb.adminAccessLog.count({ where: { userId: bob.user.id } }),
		).toBe(1);
	});

	it("does not let one person read another's rows by id", async () => {
		const bobsRow = await adminDb.adminAccessLog.findFirstOrThrow({
			where: { userId: bob.user.id },
		});
		const seen = await eve.db.adminAccessLog.findUnique({
			where: { id: bobsRow.id },
		});
		expect(seen).toBeNull();
	});

	it("answers NOT_FOUND for a person who does not exist and writes nothing", async () => {
		const before = await adminDb.adminAccessLog.count();
		await expect(
			recordAdminAccess(adminDb, {
				adminId: admin.user.id,
				userId: "no-such-user",
				action: "enabled",
			}),
		).rejects.toBeInstanceOf(TRPCError);
		await expect(
			asAdmin(admin).enableUser({ userId: "no-such-user" }),
		).rejects.toThrow();
		expect(await adminDb.adminAccessLog.count()).toBe(before);
	});
});

describe("admin access log: a refused or failed action writes nothing", () => {
	let admin: Made;
	let target: Made;

	beforeAll(async () => {
		admin = await createTestUser({ role: "ADMIN" });
		target = await createTestUser();
	});

	const entriesFor = (userId: string) =>
		adminDb.adminAccessLog.count({ where: { userId } });

	it("an admin disabling their own account is refused and not logged", async () => {
		await expect(
			asAdmin(admin).disableUser({ userId: admin.user.id }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(await entriesFor(admin.user.id)).toBe(0);
		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: admin.user.id } }))
				.isActive,
		).toBe(true);
	});

	it("disabling the last active admin is refused and not logged", async () => {
		const lastAdmin = await createTestUser({ role: "ADMIN" });
		const others = await adminDb.user.findMany({
			where: { role: "ADMIN", isActive: true, id: { not: lastAdmin.user.id } },
			select: { id: true },
		});
		await adminDb.user.updateMany({
			where: { id: { in: others.map((o) => o.id) } },
			data: { isActive: false },
		});
		try {
			await expect(
				asAdmin(admin).disableUser({ userId: lastAdmin.user.id }),
			).rejects.toBeInstanceOf(LastAdminError);
			expect(await entriesFor(lastAdmin.user.id)).toBe(0);
		} finally {
			await adminDb.user.updateMany({
				where: { id: { in: others.map((o) => o.id) } },
				data: { isActive: true },
			});
		}
	});

	it("input that fails validation is not logged", async () => {
		await expect(
			asAdmin(admin).setUserAiAccess({
				userId: target.user.id,
				externalAiAllowed: "yes" as unknown as boolean,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await entriesFor(target.user.id)).toBe(0);
	});

	it("the same action, when it succeeds, is logged once", async () => {
		await asAdmin(admin).setUserAiAccess({
			userId: target.user.id,
			externalAiAllowed: true,
		});
		expect(await entriesFor(target.user.id)).toBe(1);
	});
});

describe("admin access log: an admin deleting a Person", () => {
	let admin: Made;
	let alice: Made;
	let bob: Made;
	let carol: Made;
	let erin: Made;

	beforeAll(async () => {
		admin = await createTestUser({ role: "ADMIN" });
		alice = await createTestUser();
		bob = await createTestUser();
		carol = await createTestUser();
		erin = await createTestUser();
	});

	const sharedWith = async (
		creatorId: string,
		participant: { type: "shadow" | "guest"; id: string },
		alsoSplitWith: string[] = [],
	) => {
		const tx = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "10",
				currency: "USD",
				date: new Date("2026-01-01T00:00:00Z"),
				paidByType: "user",
				paidById: creatorId,
				createdByType: "user",
				createdById: creatorId,
			},
		});
		const shares = [
			{ participantType: participant.type, participantId: participant.id },
			...alsoSplitWith.map((id) => ({
				participantType: "user" as const,
				participantId: id,
			})),
		];
		for (const share of shares) {
			await adminDb.splitParticipant.create({
				data: { transactionId: tx.id, shareAmount: "5", ...share },
			});
		}
	};

	/** An expense whose payer's account was deleted: the payer is the sentinel. */
	const paidByDeletedUser = async (participant: {
		type: "shadow" | "guest";
		id: string;
	}) => {
		const tx = await adminDb.sharedTransaction.create({
			data: {
				description: "Old dinner",
				amount: "10",
				currency: "USD",
				date: new Date("2026-01-01T00:00:00Z"),
				paidByType: "user",
				paidById: "DELETED_USER",
				createdByType: "user",
				createdById: "DELETED_USER",
			},
		});
		await adminDb.splitParticipant.create({
			data: {
				transactionId: tx.id,
				participantType: participant.type,
				participantId: participant.id,
				shareAmount: "5",
			},
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: participant.type,
				fromParticipantId: participant.id,
				toParticipantType: "user",
				toParticipantId: "DELETED_USER",
				amount: "5",
				currency: "USD",
			},
		});
	};

	it("tells the person who added the Person, and whose expenses were rewritten", async () => {
		const shadow = await adminDb.shadowProfile.create({
			data: { createdById: alice.user.id, name: "Dana" },
		});
		await sharedWith(bob.user.id, { type: "shadow", id: shadow.id }, [
			bob.user.id,
			erin.user.id,
		]);

		await asAdmin(admin).deleteShadowProfile({ id: shadow.id });

		expect((await asUser(alice).list()).map((r) => r.action)).toEqual([
			"person_deleted",
		]);
		expect((await asUser(bob).list()).map((r) => r.action)).toEqual([
			"shared_data_changed",
		]);
		// Erin shares the expense without having paid or created it.
		expect((await asUser(erin).list()).map((r) => r.action)).toEqual([
			"shared_data_changed",
		]);
		expect(await asUser(carol).list()).toEqual([]);
		const rows = await adminDb.adminAccessLog.findMany({
			where: { userId: { in: [alice.user.id, bob.user.id] } },
		});
		expect(rows.every((r) => r.adminId === admin.user.id)).toBe(true);
	});

	it("tells the people whose expenses a deleted guest was in", async () => {
		const guest = await adminDb.guestSession.create({
			data: {
				name: "Gus",
				email: "gus@pg-test.invalid",
				magicLinkId: "ml-1",
				projectId: "p-1",
				sessionToken: `tok-${Math.random()}`,
			},
		});
		await sharedWith(carol.user.id, { type: "guest", id: guest.id });

		await asAdmin(admin).deleteGuestSession({ id: guest.id });

		expect((await asUser(carol).list()).map((r) => r.action)).toEqual([
			"shared_data_changed",
		]);
	});

	it("deletes a guest whose expense payer's account was deleted", async () => {
		const guest = await adminDb.guestSession.create({
			data: {
				name: "Gus",
				email: "gus2@pg-test.invalid",
				magicLinkId: "ml-2",
				projectId: "p-2",
				sessionToken: `tok-${Math.random()}`,
			},
		});
		await paidByDeletedUser({ type: "guest", id: guest.id });

		await asAdmin(admin).deleteGuestSession({ id: guest.id });

		expect(
			await adminDb.guestSession.findUnique({ where: { id: guest.id } }),
		).toBeNull();
		expect(await adminDb.adminAccessLog.count({ where: { userId: "DELETED_USER" } })).toBe(0);
	});

	it("deletes a Person whose expense payer's account was deleted, and still tells the owner", async () => {
		const owner = await createTestUser();
		const shadow = await adminDb.shadowProfile.create({
			data: { createdById: owner.user.id, name: "Dan" },
		});
		await paidByDeletedUser({ type: "shadow", id: shadow.id });

		await asAdmin(admin).deleteShadowProfile({ id: shadow.id });

		expect(
			await adminDb.shadowProfile.findUnique({ where: { id: shadow.id } }),
		).toBeNull();
		expect((await asUser(owner).list()).map((r) => r.action)).toEqual([
			"person_deleted",
		]);
	});

	it("a missing Person writes nothing", async () => {
		const before = await adminDb.adminAccessLog.count();
		await expect(
			asAdmin(admin).deleteShadowProfile({ id: "no-such-person" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await adminDb.adminAccessLog.count()).toBe(before);
	});
});
