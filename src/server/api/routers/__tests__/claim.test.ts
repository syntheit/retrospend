/**
 * Claim router tests: claim-link minting scope, token binding, the public
 * claim preview, and invite-link validation on the join chooser paths.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
	projectId: string;
	participantType: string;
	participantId: string;
	role: string;
};

const state = vi.hoisted(() => ({
	rows: [] as Row[],
	shadow: null as null | {
		id: string;
		name: string;
		claimedById: string | null;
		createdById: string;
		updatedAt: Date;
	},
	link: null as null | {
		projectId: string;
		isActive: boolean;
		expiresAt: Date | null;
		maxUses: number | null;
		useCount: number;
	},
	guest: null as null | {
		id: string;
		name: string;
		sessionToken: string;
		projectId: string;
	},
}));

function matches(row: Row, where: Record<string, unknown>): boolean {
	const pid = where.projectId as string | { in: string[] } | undefined;
	if (typeof pid === "string" && row.projectId !== pid) return false;
	if (pid && typeof pid === "object" && !pid.in.includes(row.projectId)) return false;
	if (where.participantType && row.participantType !== where.participantType)
		return false;
	if (where.participantId && row.participantId !== where.participantId) return false;
	return true;
}

const mockDb = vi.hoisted(() => ({
	shadowProfile: { findUnique: vi.fn() },
	projectParticipant: { findMany: vi.fn(), findUnique: vi.fn() },
	project: { findMany: vi.fn() },
	magicLink: { findUnique: vi.fn() },
	guestSession: { findUnique: vi.fn() },
}));

const mockClaimShadowProfile = vi.hoisted(() => vi.fn());
const mockMergeShadowIntoGuest = vi.hoisted(() => vi.fn());

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

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/services/claim.service", async () => {
	const actual = await vi.importActual<
		typeof import("~/server/services/claim.service")
	>("~/server/services/claim.service");
	return {
		...actual,
		claimShadowProfile: mockClaimShadowProfile,
		mergeShadowIntoGuest: mockMergeShadowIntoGuest,
		listUnclaimedProjectGhosts: vi.fn().mockResolvedValue([{ id: "s", name: "Ghost" }]),
	};
});

import { signClaimToken } from "~/lib/claim-token";
import { createCallerFactory } from "~/server/api/trpc";
import { makeSession } from "~/test/trpc-test-utils";
import { claimRouter } from "../claim";

const createCaller = createCallerFactory(claimRouter);

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

function caller(session: unknown = null, headers = new Headers()) {
	return createCaller({ session: session as never, db: mockDb as never, headers });
}

const SHADOW_UPDATED_AT = new Date("2026-10-01T00:00:00Z");

function tokenFor(issuerId: string, version = SHADOW_UPDATED_AT.getTime()) {
	return signClaimToken({ shadowId: "shadow-1", version, issuerId }, "secret");
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	state.rows = [
		{ projectId: "proj-a", participantType: "shadow", participantId: "shadow-1", role: "CONTRIBUTOR" },
		{ projectId: "proj-b", participantType: "shadow", participantId: "shadow-1", role: "CONTRIBUTOR" },
		{ projectId: "proj-a", participantType: "user", participantId: "editor-1", role: "EDITOR" },
	];
	state.shadow = {
		id: "shadow-1",
		name: "Ghost",
		claimedById: null,
		createdById: "editor-1",
		updatedAt: SHADOW_UPDATED_AT,
	};
	state.link = {
		projectId: "proj-a",
		isActive: true,
		expiresAt: null,
		maxUses: null,
		useCount: 0,
	};
	state.guest = {
		id: "guest-1",
		name: "Guest",
		sessionToken: createHash("sha256").update("guest-token").digest("hex"),
		projectId: "proj-a",
	};

	mockDb.shadowProfile.findUnique.mockImplementation(() => state.shadow);
	mockDb.projectParticipant.findMany.mockImplementation(
		(args: { where: Record<string, unknown> }) =>
			state.rows.filter((r) => matches(r, args.where)),
	);
	mockDb.projectParticipant.findUnique.mockImplementation(
		(args: { where: { projectId_participantType_participantId: Record<string, string> } }) =>
			state.rows.find((r) => matches(r, args.where.projectId_participantType_participantId)) ??
			null,
	);
	mockDb.project.findMany.mockResolvedValue([
		{ id: "proj-a", name: "Trip A" },
		{ id: "proj-b", name: "Trip B" },
	]);
	mockDb.magicLink.findUnique.mockImplementation(() => state.link);
	mockDb.guestSession.findUnique.mockImplementation(() => state.guest);
	mockClaimShadowProfile.mockResolvedValue({
		shadowId: "shadow-1",
		shadowName: "Ghost",
		projectIds: ["proj-a", "proj-b"],
		alreadyClaimed: false,
	});
	mockMergeShadowIntoGuest.mockResolvedValue({ shadowName: "Ghost" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("claim.generateLink", () => {
	it("refuses an editor of only one of the ghost's projects", async () => {
		await expect(
			callAndFlush(() =>
				caller(makeSession({ id: "editor-1" })).generateLink({ shadowId: "shadow-1" }),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("allows an editor or organizer of every project the ghost is in", async () => {
		state.rows.push({
			projectId: "proj-b",
			participantType: "user",
			participantId: "editor-1",
			role: "ORGANIZER",
		});

		const result = await callAndFlush(() =>
			caller(makeSession({ id: "editor-1" })).generateLink({ shadowId: "shadow-1" }),
		);
		expect(result.url).toContain("/claim/");
	});

	it("refuses a contributor even when they created the ghost", async () => {
		state.rows = state.rows.filter((r) => r.projectId === "proj-a");
		state.rows[1]!.role = "CONTRIBUTOR";

		await expect(
			callAndFlush(() =>
				caller(makeSession({ id: "editor-1" })).generateLink({ shadowId: "shadow-1" }),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("lets the creator share a standalone ghost", async () => {
		state.rows = [];
		const result = await callAndFlush(() =>
			caller(makeSession({ id: "editor-1" })).generateLink({ shadowId: "shadow-1" }),
		);
		expect(result.token).toBeTruthy();
	});
});

describe("claim.claimByToken", () => {
	beforeEach(() => {
		state.rows.push({
			projectId: "proj-b",
			participantType: "user",
			participantId: "editor-1",
			role: "EDITOR",
		});
	});

	it("claims with a link that still matches the ghost and issuer", async () => {
		const result = await callAndFlush(() =>
			caller(makeSession({ id: "claimer" })).claimByToken({ token: tokenFor("editor-1") }),
		);
		expect(result.name).toBe("Ghost");
		expect(mockClaimShadowProfile).toHaveBeenCalledWith(mockDb, "shadow-1", "claimer");
	});

	it("rejects a link once the ghost is gone (already claimed and absorbed)", async () => {
		state.shadow = null;
		await expect(
			callAndFlush(() =>
				caller(makeSession({ id: "claimer" })).claimByToken({ token: tokenFor("editor-1") }),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mockClaimShadowProfile).not.toHaveBeenCalled();
	});

	it("rejects a link minted before the ghost was edited", async () => {
		state.shadow!.updatedAt = new Date("2026-10-02T00:00:00Z");
		await expect(
			callAndFlush(() =>
				caller(makeSession({ id: "claimer" })).claimByToken({ token: tokenFor("editor-1") }),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mockClaimShadowProfile).not.toHaveBeenCalled();
	});

	it("rejects a link whose issuer no longer runs every project of the ghost", async () => {
		state.rows.push({
			projectId: "proj-c",
			participantType: "shadow",
			participantId: "shadow-1",
			role: "CONTRIBUTOR",
		});
		await expect(
			callAndFlush(() =>
				caller(makeSession({ id: "claimer" })).claimByToken({ token: tokenFor("editor-1") }),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mockClaimShadowProfile).not.toHaveBeenCalled();
	});
});

describe("claim.info", () => {
	beforeEach(() => {
		state.rows.push({
			projectId: "proj-b",
			participantType: "user",
			participantId: "editor-1",
			role: "EDITOR",
		});
	});

	it("tells a logged-out visitor only the ghost's name", async () => {
		const result = await callAndFlush(() =>
			caller().info({ token: tokenFor("editor-1") }),
		);
		expect(result).toEqual({ name: "Ghost", alreadyClaimed: false, projects: [] });
		expect(mockDb.project.findMany).not.toHaveBeenCalled();
	});

	it("lists the projects for a signed-in user about to claim", async () => {
		const result = await callAndFlush(() =>
			caller(makeSession({ id: "claimer" })).info({ token: tokenFor("editor-1") }),
		);
		expect(result.projects.map((p) => p.name)).toEqual(["Trip A", "Trip B"]);
	});
});

describe("claim.projectGhosts", () => {
	it("lists ghosts for a live invite link", async () => {
		const result = await callAndFlush(() => caller().projectGhosts({ linkId: "link-1" }));
		expect(result).toHaveLength(1);
	});

	it.each([
		["revoked", { isActive: false }],
		["expired", { expiresAt: new Date("2000-01-01") }],
		["used up", { maxUses: 1, useCount: 1 }],
	])("rejects a %s invite link", async (_label, patch) => {
		Object.assign(state.link!, patch);
		await expect(
			callAndFlush(() => caller().projectGhosts({ linkId: "link-1" })),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("claim.linkGuestToGhost", () => {
	const input = { linkId: "link-1", guestSessionId: "guest-1", shadowId: "shadow-1" };
	const guestHeaders = () => new Headers({ "x-guest-token": "guest-token" });

	beforeEach(() => {
		state.rows.push({
			projectId: "proj-a",
			participantType: "guest",
			participantId: "guest-1",
			role: "CONTRIBUTOR",
		});
	});

	it("links a contributing guest even when their single-use link is now used up", async () => {
		Object.assign(state.link!, { maxUses: 1, useCount: 1 });
		const result = await callAndFlush(() =>
			caller(null, guestHeaders()).linkGuestToGhost(input),
		);
		expect(result.name).toBe("Ghost");
		expect(mockMergeShadowIntoGuest).toHaveBeenCalled();
	});

	it("rejects a revoked invite link", async () => {
		state.link!.isActive = false;
		await expect(
			callAndFlush(() => caller(null, guestHeaders()).linkGuestToGhost(input)),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mockMergeShadowIntoGuest).not.toHaveBeenCalled();
	});

	it("rejects an expired invite link", async () => {
		state.link!.expiresAt = new Date("2000-01-01");
		await expect(
			callAndFlush(() => caller(null, guestHeaders()).linkGuestToGhost(input)),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a viewer guest", async () => {
		state.rows.find((r) => r.participantId === "guest-1")!.role = "VIEWER";
		await expect(
			callAndFlush(() => caller(null, guestHeaders()).linkGuestToGhost(input)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(mockMergeShadowIntoGuest).not.toHaveBeenCalled();
	});

	it("rejects a guest who was removed from the project", async () => {
		state.rows = state.rows.filter((r) => r.participantId !== "guest-1");
		await expect(
			callAndFlush(() => caller(null, guestHeaders()).linkGuestToGhost(input)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
