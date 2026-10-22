/**
 * auditLog.projectsLastActivity: one query for the whole projects list,
 * limited to projects the caller is a participant of.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
	user: { findUnique: vi.fn() },
	projectParticipant: { findMany: vi.fn() },
	auditLogEntry: { findMany: vi.fn() },
	$queryRaw: vi.fn(),
}));

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));

vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn(() => null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { auditLogRouter } from "../audit-log";

const caller = () =>
	createCallerFactory(auditLogRouter)({
		db: mockDb as never,
		session: {
			user: {
				id: "me",
				role: "USER",
				email: "me@test.com",
				name: "Me",
				isActive: true,
			},
		} as never,
		headers: new Headers(),
	} as never);

function entry(id: string, projectId: string) {
	return {
		id,
		timestamp: new Date("2026-10-01T12:00:00Z"),
		actorType: "user",
		actorId: "me",
		action: "EDITED",
		targetType: "PROJECT",
		targetId: projectId,
		changes: null,
		context: null,
		projectId,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockDb.user.findUnique.mockResolvedValue({
		isActive: true,
		name: "Me",
		avatarPath: null,
		image: null,
	});
});

describe("auditLog.projectsLastActivity", () => {
	it("returns nothing without a query when no ids are given", async () => {
		await expect(
			caller().projectsLastActivity({ projectIds: [] }),
		).resolves.toEqual({});
		expect(mockDb.$queryRaw).not.toHaveBeenCalled();
	});

	it("fetches the latest entry for every project in one query", async () => {
		mockDb.projectParticipant.findMany.mockResolvedValue([
			{ projectId: "p1", role: "ORGANIZER" },
			{ projectId: "p2", role: "VIEWER" },
		]);
		mockDb.$queryRaw.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
		mockDb.auditLogEntry.findMany.mockResolvedValue([
			entry("a2", "p2"),
			entry("a1", "p1"),
		]);

		const result = await caller().projectsLastActivity({
			projectIds: ["p1", "p2"],
		});

		expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
		expect(Object.keys(result).sort()).toEqual(["p1", "p2"]);
		expect(result.p1?.id).toBe("a1");
		expect(result.p2?.id).toBe("a2");
	});

	it("leaves out projects the caller is not part of", async () => {
		mockDb.projectParticipant.findMany.mockResolvedValue([
			{ projectId: "p1", role: "CONTRIBUTOR" },
		]);
		mockDb.$queryRaw.mockResolvedValue([{ id: "a1" }]);
		mockDb.auditLogEntry.findMany.mockResolvedValue([entry("a1", "p1")]);

		const result = await caller().projectsLastActivity({
			projectIds: ["p1", "someone-elses"],
		});

		const [, ids] = mockDb.$queryRaw.mock.calls[0]!;
		expect(ids).toEqual(["p1"]);
		expect(Object.keys(result)).toEqual(["p1"]);
	});

	it("skips the activity query when the caller is in none of the projects", async () => {
		mockDb.projectParticipant.findMany.mockResolvedValue([]);

		await expect(
			caller().projectsLastActivity({ projectIds: ["x", "y"] }),
		).resolves.toEqual({});
		expect(mockDb.$queryRaw).not.toHaveBeenCalled();
	});
});
