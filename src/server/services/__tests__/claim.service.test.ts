import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeShadowIntoGuest } from "../claim.service";

type Membership = { id: string; role: string };

function makeDb(opts: { shadowRole: string; guest: Membership | null }) {
	const tx = {
		projectParticipant: {
			findUnique: vi.fn().mockResolvedValue(opts.guest),
			update: vi.fn(),
			delete: vi.fn(),
		},
		sharedTransaction: { updateMany: vi.fn() },
		splitParticipant: { updateMany: vi.fn() },
		settlement: { updateMany: vi.fn() },
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
});
