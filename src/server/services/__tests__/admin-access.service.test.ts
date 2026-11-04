import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~prisma";
import {
	ADMIN_ACCESS_ACTIONS,
	logAdminProcedure,
} from "../admin-access.service";

function fakeDb() {
	const create = vi.fn(async () => ({}));
	return { db: { adminAccessLog: { create } } as unknown as PrismaClient, create };
}

describe("logAdminProcedure", () => {
	it("logs each procedure that acts on an account under its own code", async () => {
		const seen: string[] = [];
		const cases: Array<[string, string]> = [
			["admin.resetPassword", "password_reset"],
			["admin.generatePasswordResetLink", "reset_link"],
			["admin.disableUser", "disabled"],
			["admin.enableUser", "enabled"],
			["admin.markEmailVerified", "email_verified"],
			["admin.toggleEmailVerification", "email_verification_changed"],
			["admin.setUserAiAccess", "ai_access_changed"],
			["admin.removeUserAvatar", "avatar_removed"],
		];
		for (const [path, action] of cases) {
			const { db, create } = fakeDb();
			await logAdminProcedure(db, {
				path,
				adminId: "admin-1",
				rawInput: { userId: "bob" },
			});
			expect(create).toHaveBeenCalledWith({
				data: { userId: "bob", adminId: "admin-1", action },
			});
			seen.push(action);
		}
		expect(seen.sort()).toEqual([...ADMIN_ACCESS_ACTIONS].sort());
	});

	it("also matches a router called without the admin prefix", async () => {
		const { db, create } = fakeDb();
		await logAdminProcedure(db, {
			path: "disableUser",
			adminId: "a",
			rawInput: { userId: "bob" },
		});
		expect(create).toHaveBeenCalledOnce();
	});

	it("logs nothing for procedures that do not act on one account", async () => {
		const { db, create } = fakeDb();
		for (const path of [
			"admin.listUsers",
			"admin.getStats",
			"admin.deleteUser",
			"admin.toString",
			"admin.constructor",
		]) {
			await logAdminProcedure(db, {
				path,
				adminId: "a",
				rawInput: { userId: "bob" },
			});
		}
		expect(create).not.toHaveBeenCalled();
	});

	it("logs nothing without a person id in the input", async () => {
		const { db, create } = fakeDb();
		for (const rawInput of [undefined, null, {}, { userId: 5 }, { userId: "" }]) {
			await logAdminProcedure(db, {
				path: "admin.enableUser",
				adminId: "a",
				rawInput,
			});
		}
		expect(create).not.toHaveBeenCalled();
	});

	it("lets the failure through so the action does not happen", async () => {
		const create = vi.fn().mockRejectedValue(new Error("disk full"));
		const db = { adminAccessLog: { create } } as unknown as PrismaClient;
		await expect(
			logAdminProcedure(db, {
				path: "admin.enableUser",
				adminId: "a",
				rawInput: { userId: "bob" },
			}),
		).rejects.toThrow("disk full");
	});
});
