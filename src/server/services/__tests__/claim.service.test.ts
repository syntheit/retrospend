import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GhostInOtherProjectsError,
	listUnclaimedProjectGhosts,
	mergeShadowIntoGuest,
} from "../claim.service";

type Membership = { id: string; role: string };

function makeDb(opts: {
	shadowRole: string;
	guest: Membership | null;
	/** other projects the ghost is also in */
	otherProjects?: string[];
	/** history the ghost has outside this project (no membership needed) */
	outside?: { paid?: boolean; split?: boolean; settlement?: boolean };
}) {
	const tx = {
		projectParticipant: {
			findUnique: vi.fn().mockResolvedValue(opts.guest),
			findMany: vi
				.fn()
				.mockResolvedValue(
					(opts.otherProjects ?? []).map((p) => ({
						id: `pp-${p}`,
						participantId: "shadow-1",
					})),
				),
			update: vi.fn(),
			delete: vi.fn(),
		},
		sharedTransaction: {
			updateMany: vi.fn(),
			findMany: vi
				.fn()
				.mockResolvedValue(opts.outside?.paid ? [{ paidById: "shadow-1" }] : []),
		},
		splitParticipant: {
			updateMany: vi.fn(),
			findMany: vi
				.fn()
				.mockResolvedValue(
					opts.outside?.split ? [{ participantId: "shadow-1" }] : [],
				),
		},
		payment: { updateMany: vi.fn() },
		settlement: {
			updateMany: vi.fn(),
			findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
				opts.outside?.settlement && "toParticipantId" in args.where
					? [{ toParticipantId: "shadow-1" }]
					: [],
			),
		},
		auditLogEntry: { updateMany: vi.fn() },
		shadowProfile: { delete: vi.fn() },
		$executeRaw: vi.fn(),
	};
	const db = {
		shadowProfile: {
			findUnique: vi
				.fn()
				.mockResolvedValue({ id: "shadow-1", name: "Ghost", claimedById: null }),
		},
		projectParticipant: {
			findUnique: vi.fn().mockResolvedValue({ id: "pp-shadow", role: opts.shadowRole }),
		},
		$transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
	};
	return { db, tx };
}

describe("mergeShadowIntoGuest", () => {
	beforeEach(() => vi.clearAllMocks());

	it("never raises the guest's role to the ghost's role", async () => {
		const { db, tx } = makeDb({
			shadowRole: "CONTRIBUTOR",
			guest: { id: "pp-guest", role: "VIEWER" },
		});

		await mergeShadowIntoGuest(db as never, "shadow-1", "guest-1", "proj-1");

		expect(tx.projectParticipant.update).not.toHaveBeenCalled();
		expect(tx.projectParticipant.delete).toHaveBeenCalledWith({
			where: { id: "pp-shadow" },
		});
		expect(tx.shadowProfile.delete).toHaveBeenCalledWith({ where: { id: "shadow-1" } });
	});

	it("refuses when the guest is no longer a member of the project", async () => {
		const { db, tx } = makeDb({ shadowRole: "CONTRIBUTOR", guest: null });

		await expect(
			mergeShadowIntoGuest(db as never, "shadow-1", "guest-1", "proj-1"),
		).rejects.toThrow();

		expect(tx.projectParticipant.update).not.toHaveBeenCalled();
		expect(tx.shadowProfile.delete).not.toHaveBeenCalled();
	});

	it("refuses a ghost that is also in other projects and touches nothing", async () => {
		const { db, tx } = makeDb({
			shadowRole: "CONTRIBUTOR",
			guest: { id: "pp-guest", role: "CONTRIBUTOR" },
			otherProjects: ["proj-2"],
		});

		await expect(
			mergeShadowIntoGuest(db as never, "shadow-1", "guest-1", "proj-1"),
		).rejects.toBeInstanceOf(GhostInOtherProjectsError);

		expect(tx.projectParticipant.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					participantType: "shadow",
					participantId: { in: ["shadow-1"] },
					NOT: { projectId: "proj-1" },
				},
			}),
		);
		expect(tx.projectParticipant.delete).not.toHaveBeenCalled();
		expect(tx.sharedTransaction.updateMany).not.toHaveBeenCalled();
		expect(tx.shadowProfile.delete).not.toHaveBeenCalled();
	});

	it.each([
		["paid an expense outside the project", { paid: true }],
		["is in the split of an expense outside the project", { split: true }],
		["received a settlement outside the project", { settlement: true }],
	])("refuses a ghost that %s, even with no other membership", async (_label, outside) => {
		const { db, tx } = makeDb({
			shadowRole: "CONTRIBUTOR",
			guest: { id: "pp-guest", role: "CONTRIBUTOR" },
			outside,
		});

		await expect(
			mergeShadowIntoGuest(db as never, "shadow-1", "guest-1", "proj-1"),
		).rejects.toBeInstanceOf(GhostInOtherProjectsError);

		expect(tx.sharedTransaction.updateMany).not.toHaveBeenCalled();
		expect(tx.splitParticipant.updateMany).not.toHaveBeenCalled();
		expect(tx.shadowProfile.delete).not.toHaveBeenCalled();
	});

	it("looks for outside history in other projects and in project-less rows", async () => {
		const { db, tx } = makeDb({
			shadowRole: "CONTRIBUTOR",
			guest: { id: "pp-guest", role: "CONTRIBUTOR" },
		});

		await mergeShadowIntoGuest(db as never, "shadow-1", "guest-1", "proj-1");

		const outsideProject = {
			OR: [{ projectId: null }, { projectId: { not: "proj-1" } }],
		};
		expect(tx.sharedTransaction.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining(outsideProject),
			}),
		);
		expect(tx.splitParticipant.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ transaction: outsideProject }),
			}),
		);
		expect(tx.shadowProfile.delete).toHaveBeenCalled();
	});
});

describe("listUnclaimedProjectGhosts", () => {
	it("marks ghosts that are also in other projects as not linkable", async () => {
		const db = {
			projectParticipant: {
				findMany: vi
					.fn()
					// the project's ghost memberships
					.mockResolvedValueOnce([{ participantId: "s-only" }, { participantId: "s-shared" }])
					// memberships of those ghosts in other projects
					.mockResolvedValueOnce([{ participantId: "s-shared" }]),
			},
			shadowProfile: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "s-only", name: "Ann" },
					{ id: "s-shared", name: "Bob" },
				]),
			},
			sharedTransaction: { findMany: vi.fn().mockResolvedValue([]) },
			splitParticipant: { findMany: vi.fn().mockResolvedValue([]) },
			settlement: { findMany: vi.fn().mockResolvedValue([]) },
		};

		const result = await listUnclaimedProjectGhosts(db as never, "proj-1");

		expect(result).toEqual([
			{ id: "s-only", name: "Ann", linkable: true },
			{ id: "s-shared", name: "Bob", linkable: false },
		]);
	});
});

describe("listUnclaimedProjectGhosts outside history", () => {
	it("marks a ghost with direct (project-less) expenses as not linkable", async () => {
		const db = {
			projectParticipant: {
				findMany: vi
					.fn()
					.mockResolvedValueOnce([{ participantId: "s-only" }, { participantId: "s-direct" }])
					.mockResolvedValueOnce([]),
			},
			shadowProfile: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "s-only", name: "Ann" },
					{ id: "s-direct", name: "Dee" },
				]),
			},
			sharedTransaction: { findMany: vi.fn().mockResolvedValue([]) },
			splitParticipant: {
				findMany: vi.fn().mockResolvedValue([{ participantId: "s-direct" }]),
			},
			settlement: { findMany: vi.fn().mockResolvedValue([]) },
		};

		const result = await listUnclaimedProjectGhosts(db as never, "proj-1");

		expect(result).toEqual([
			{ id: "s-only", name: "Ann", linkable: true },
			{ id: "s-direct", name: "Dee", linkable: false },
		]);
	});
});
