import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogEventAsync = vi.hoisted(() => vi.fn());
const mockClaimShadowProfile = vi.hoisted(() => vi.fn());

vi.mock("../audit.service", () => ({ logEventAsync: mockLogEventAsync }));
vi.mock("../claim.service", () => ({
	AlreadyClaimedError: class extends Error {},
	claimShadowProfile: mockClaimShadowProfile,
}));

import { migrateGuestDataForVerifiedUser } from "../guest-migration.service";

function makeDb(user: { email: string; emailVerified: boolean } | null) {
	return {
		user: { findUnique: vi.fn().mockResolvedValue(user) },
		guestSession: { findMany: vi.fn().mockResolvedValue([]) },
		shadowProfile: {
			findMany: vi.fn().mockResolvedValue([{ id: "shadow-1" }]),
		},
		$transaction: vi.fn(),
	};
}

describe("migrateGuestDataForVerifiedUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockClaimShadowProfile.mockResolvedValue({});
	});

	it("does nothing for an unverified email", async () => {
		const db = makeDb({ email: "victim@example.com", emailVerified: false });

		const result = await migrateGuestDataForVerifiedUser(db as never, "user-1");

		expect(result).toBeNull();
		expect(db.guestSession.findMany).not.toHaveBeenCalled();
		expect(db.shadowProfile.findMany).not.toHaveBeenCalled();
		expect(mockClaimShadowProfile).not.toHaveBeenCalled();
	});

	it("claims matching ghosts once the email is verified", async () => {
		const db = makeDb({ email: "Owner@Example.com", emailVerified: true });

		const result = await migrateGuestDataForVerifiedUser(db as never, "user-1");

		expect(db.shadowProfile.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { email: "owner@example.com", claimedById: null },
			}),
		);
		expect(mockClaimShadowProfile).toHaveBeenCalledWith(db, "shadow-1", "user-1");
		expect(result?.claimedShadowCount).toBe(1);
		expect(mockLogEventAsync).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "GUEST_UPGRADED", userId: "user-1" }),
		);
	});

	it("swallows errors so the triggering action still succeeds", async () => {
		const db = makeDb({ email: "owner@example.com", emailVerified: true });
		db.guestSession.findMany.mockRejectedValue(new Error("db down"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			migrateGuestDataForVerifiedUser(db as never, "user-1"),
		).resolves.toBeNull();
		spy.mockRestore();
	});
});
