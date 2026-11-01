/**
 * The admin page's figures on real Postgres: only an admin reads them, and
 * each count moves with the data it names (people, sign-ins this week,
 * unread feedback, error reports, used and open invites).
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { adminOverviewRouter } from "../admin-overview";

vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	getStorageSize: vi.fn(async () => 1234),
}));

type Made = Awaited<ReturnType<typeof createTestUser>>;

const as = (u: Made, role: "ADMIN" | "USER") =>
	createCallerFactory(adminOverviewRouter)({
		session: makeSession({ id: u.user.id, name: u.user.name, role }),
		db: u.db,
		headers: new Headers(),
	});

const DAY = 24 * 60 * 60 * 1000;

describe("admin.getOverview", () => {
	let admin: Made;
	let bob: Made;

	beforeAll(async () => {
		admin = await createTestUser({ role: "ADMIN" });
		bob = await createTestUser();
	});

	it("refuses a member", async () => {
		await expect(as(bob, "USER").getOverview()).rejects.toBeInstanceOf(
			TRPCError,
		);
	});

	it("counts what each figure names", async () => {
		const before = await as(admin, "ADMIN").getOverview();

		const session = (userId: string, updatedAt: Date) =>
			adminDb.session.create({
				data: {
					id: randomUUID(),
					token: randomUUID(),
					userId,
					expiresAt: new Date(Date.now() + DAY),
					updatedAt,
				},
			});
		await session(bob.user.id, new Date());
		const late = await createTestUser();
		await session(late.user.id, new Date(Date.now() - 30 * DAY));

		await adminDb.feedback.create({
			data: { userId: bob.user.id, message: "hello", pageUrl: "/home" },
		});
		await adminDb.errorReport.create({
			data: {
				userId: bob.user.id,
				kind: "crash",
				message: "boom",
				occurredAt: new Date(),
			},
		});
		const code = (usedById: string | null) =>
			adminDb.inviteCode.create({
				data: {
					code: randomUUID().slice(0, 8),
					createdById: admin.user.id,
					usedById,
					usedAt: usedById ? new Date() : null,
				},
			});
		await code(bob.user.id);
		await code(null);

		const after = await as(admin, "ADMIN").getOverview();
		expect(after.users - before.users).toBe(1);
		// Only bob signed in this week; the other session is a month old.
		expect(after.activeUsers - before.activeUsers).toBe(1);
		expect(after.unreadFeedback - before.unreadFeedback).toBe(1);
		expect(after.errorReports - before.errorReports).toBe(1);
		expect(after.invitesUsed - before.invitesUsed).toBe(1);
		expect(after.invitesOpen - before.invitesOpen).toBe(1);
		expect(after.mediaBytes).toBe(1234);
		expect(after.databaseBytes).toBeGreaterThan(0);
		expect(after.version).toMatch(/^\d+\.\d+\.\d+/);
	});
});
