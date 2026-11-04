/**
 * The admin access log on real Postgres (RLS on): an admin acting on a person
 * writes one row with the global connection, the person reads only their own
 * rows through the user-scoped connection, and the person cannot add, change
 * or delete a row. A missing person is NOT_FOUND and nothing is written.
 */
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { adminAccessRouter } from "~/server/api/routers/admin-access";
import { adminRouter } from "~/server/api/routers/admin";
import { createCallerFactory } from "~/server/api/trpc";
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
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await adminDb.adminAccessLog.count()).toBe(before);
	});
});
