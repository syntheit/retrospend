import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~prisma";

vi.mock("~/server/services/audit.service", () => ({ logEvent: vi.fn() }));

import { logEvent } from "~/server/services/audit.service";
import {
	ADMIN_ACCESS_ACTIONS,
	isFirstPage,
	logAdminProcedure,
	recordAdminListView,
	recordAdminRead,
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
		// The Person deletions log through recordParticipantRemoval, and reads
		// through recordAdminRead, instead.
		const viaPerson = [
			"person_deleted",
			"shared_data_changed",
			"feedback_screenshot_viewed",
		];
		expect([...seen, ...viaPerson].sort()).toEqual(
			[...ADMIN_ACCESS_ACTIONS].sort(),
		);
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

	it("lets a failed write through instead of hiding it", async () => {
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

describe("recordAdminRead", () => {
	const params = {
		adminId: "a",
		userId: "bob",
		action: "feedback_screenshot_viewed",
	} as const;
	const dbWith = (recent: { id: string } | null) => {
		const create = vi.fn(async () => ({}));
		const findFirst = vi.fn(async (_args: unknown) => recent);
		return {
			db: { adminAccessLog: { create, findFirst } } as unknown as PrismaClient,
			create,
			findFirst,
		};
	};

	it("writes one entry for the person when there is no recent one", async () => {
		const { db, create, findFirst } = dbWith(null);
		await recordAdminRead(db, params);
		expect(create).toHaveBeenCalledWith({
			data: {
				userId: "bob",
				adminId: "a",
				action: "feedback_screenshot_viewed",
			},
		});
		expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
			where: { userId: "bob", adminId: "a", action: params.action },
		});
	});

	it("adds nothing when the same admin read the same thing minutes ago", async () => {
		const { db, create } = dbWith({ id: "x" });
		await recordAdminRead(db, params);
		expect(create).not.toHaveBeenCalled();
	});

	it("lets a failed write through, so the data is not served", async () => {
		const { db, create } = dbWith(null);
		create.mockRejectedValue(new Error("disk full"));
		await expect(recordAdminRead(db, params)).rejects.toThrow("disk full");
	});
});

describe("recordAdminListView", () => {
	const view = { adminId: "a", view: "users", firstPage: true } as const;
	const dbWith = (recent: { id: string } | null) => {
		const findFirst = vi.fn(async () => recent);
		return {
			db: { eventLog: { findFirst } } as unknown as PrismaClient,
			findFirst,
		};
	};

	it("writes one admin audit event carrying ids and the list name only", async () => {
		vi.mocked(logEvent).mockClear();
		const { db } = dbWith(null);
		await recordAdminListView(db, view);
		expect(logEvent).toHaveBeenCalledExactlyOnceWith({
			eventType: "ADMIN_LIST_VIEWED",
			userId: "a",
			metadata: { adminId: "a", view: "users" },
		});
	});

	it("skips a later page and does not even look", async () => {
		vi.mocked(logEvent).mockClear();
		const { db, findFirst } = dbWith(null);
		await recordAdminListView(db, { ...view, firstPage: false });
		expect(findFirst).not.toHaveBeenCalled();
		expect(logEvent).not.toHaveBeenCalled();
	});

	it("skips a repeat within minutes", async () => {
		vi.mocked(logEvent).mockClear();
		const { db } = dbWith({ id: "x" });
		await recordAdminListView(db, view);
		expect(logEvent).not.toHaveBeenCalled();
	});

	it("never fails the read it follows", async () => {
		const findFirst = vi.fn().mockRejectedValue(new Error("down"));
		const db = { eventLog: { findFirst } } as unknown as PrismaClient;
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(recordAdminListView(db, view)).resolves.toBeUndefined();
	});
});

describe("isFirstPage", () => {
	it("is true without a cursor, an offset or a page after the first", () => {
		for (const input of [undefined, null, {}, { limit: 5 }, { offset: 0 }, { page: 1 }])
			expect(isFirstPage(input)).toBe(true);
	});

	it("is false for any later page, whichever paging the list uses", () => {
		for (const input of [{ cursor: "c" }, { offset: 20 }, { page: 2 }])
			expect(isFirstPage(input)).toBe(false);
	});
});
