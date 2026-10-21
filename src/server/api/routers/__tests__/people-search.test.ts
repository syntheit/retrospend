/**
 * people.search must not reveal ghost emails (or match on them) for ghosts the
 * caller may see but isn't allowed to see contact details for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Shadow = { id: string; name: string; email: string | null; createdById: string };
type Member = {
	projectId: string;
	participantType: string;
	participantId: string;
	role: string;
};

const state = vi.hoisted(() => ({
	shadows: [] as Shadow[],
	members: [] as Member[],
}));

const mockDb = vi.hoisted(() => ({
	shadowProfile: { findMany: vi.fn() },
	projectParticipant: { findMany: vi.fn() },
	guestSession: { findMany: vi.fn().mockResolvedValue([]) },
	splitParticipant: { findMany: vi.fn().mockResolvedValue([]) },
	user: { findMany: vi.fn().mockResolvedValue([]) },
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
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn(() => null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { makeSession } from "~/test/trpc-test-utils";
import { peopleRouter } from "../people";

const createCaller = createCallerFactory(peopleRouter);

async function search(userId: string, query: string) {
	const caller = createCaller({
		session: makeSession({ id: userId }),
		db: mockDb as never,
		headers: new Headers(),
	});
	const promise = caller.search({ query });
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	state.shadows = [
		{ id: "g-mine", name: "Dana", email: "dana@secret.test", createdById: "me" },
		{ id: "g-theirs", name: "Erin", email: "erin@secret.test", createdById: "org" },
	];
	state.members = [
		{ projectId: "p1", participantType: "user", participantId: "me", role: "CONTRIBUTOR" },
		{ projectId: "p1", participantType: "shadow", participantId: "g-theirs", role: "CONTRIBUTOR" },
	];
	mockDb.shadowProfile.findMany.mockImplementation(
		async (args: { where: { createdById?: string; id?: { in: string[] } } }) => {
			const w = args.where;
			if (w.createdById !== undefined) {
				return state.shadows.filter(
					(s) => s.createdById === w.createdById && (!w.id || w.id.in.includes(s.id)),
				);
			}
			// The search query itself: RLS-visible ghosts matching name or email.
			return state.shadows;
		},
	);
	mockDb.projectParticipant.findMany.mockImplementation(
		async (args: {
			where: {
				participantType: string;
				participantId: string | { in: string[] };
				role?: { in: string[] };
				projectId?: { in: string[] };
			};
		}) => {
			const w = args.where;
			return state.members.filter(
				(m) =>
					m.participantType === w.participantType &&
					(typeof w.participantId === "string"
						? m.participantId === w.participantId
						: w.participantId.in.includes(m.participantId)) &&
					(!w.role || w.role.in.includes(m.role)) &&
					(!w.projectId || w.projectId.in.includes(m.projectId)),
			);
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("people.search ghost emails", () => {
	it("shows the email of a ghost the caller created", async () => {
		const result = await search("me", "dana");
		expect(result.shadows).toEqual([
			expect.objectContaining({ participantId: "g-mine", email: "dana@secret.test" }),
		]);
	});

	it("hides the email of a project ghost when the caller only contributes", async () => {
		const result = await search("me", "erin");
		expect(result.shadows).toEqual([
			expect.objectContaining({ participantId: "g-theirs", email: null }),
		]);
	});

	it("does not match a hidden email by substring", async () => {
		const result = await search("me", "secret.test");
		expect(result.shadows.map((s) => s.participantId)).toEqual(["g-mine"]);
	});

	it("shows and matches the email for an editor of the ghost's project", async () => {
		state.members[0]!.role = "EDITOR";
		const result = await search("me", "erin@secret");
		expect(result.shadows).toEqual([
			expect.objectContaining({ participantId: "g-theirs", email: "erin@secret.test" }),
		]);
	});
});
