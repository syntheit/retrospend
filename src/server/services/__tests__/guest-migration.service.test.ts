import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogEventAsync = vi.hoisted(() => vi.fn());
const mockClaimShadowProfile = vi.hoisted(() => vi.fn());

vi.mock("../audit.service", () => ({ logEventAsync: mockLogEventAsync }));
vi.mock("../claim.service", () => ({
	AlreadyClaimedError: class extends Error {},
	claimShadowProfile: mockClaimShadowProfile,
}));

import { TextUnavailableError } from "~/server/crypto/field-open";
import { migrateGuestDataForVerifiedUser } from "../guest-migration.service";

function makeDb(user: { email: string; emailVerified: boolean } | null) {
	return {
		user: { findUnique: vi.fn().mockResolvedValue(user) },
		guestSession: { findMany: vi.fn().mockResolvedValue([]) },
		shadowProfile: {
			findMany: vi
				.fn()
				.mockResolvedValue([{ id: "shadow-1", email: "owner@example.com" }]),
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
				where: {
					email: { equals: "owner@example.com", mode: "insensitive" },
					claimedById: null,
				},
				select: { id: true, email: true },
			}),
		);
		expect(mockClaimShadowProfile).toHaveBeenCalledWith(db, "shadow-1", "user-1");
		expect(result?.claimedShadowCount).toBe(1);
		expect(mockLogEventAsync).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "GUEST_UPGRADED", userId: "user-1" }),
		);
	});

	it("claims only the rows whose address normalizes the same, not the superset Postgres folded", async () => {
		const db = makeDb({ email: "José@Example.com", emailVerified: true });
		db.shadowProfile.findMany.mockResolvedValue([
			{ id: "same-case", email: "JosÉ@example.COM" },
			{ id: "exact", email: "José@example.com" },
			{ id: "other", email: "jose@example.com" },
			{ id: "hidden", email: null },
		]);

		const result = await migrateGuestDataForVerifiedUser(db as never, "user-1");

		// "É" is not "é" on either path: only the ASCII letters fold.
		expect(mockClaimShadowProfile.mock.calls.map((c) => c[1])).toEqual([
			"exact",
		]);
		expect(result?.claimedShadowCount).toBe(1);
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

	it("logs a stable code, never the address, when a hash cannot be made", async () => {
		const db = makeDb({ email: "owner@example.com", emailVerified: true });
		db.guestSession.findMany.mockRejectedValue(
			new TextUnavailableError("keystore_lost"),
		);
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			migrateGuestDataForVerifiedUser(db as never, "user-1"),
		).resolves.toBeNull();
		expect(spy).toHaveBeenCalledWith(
			"[Guest Migration Error]",
			"encrypted_text_unavailable",
		);

		db.guestSession.findMany.mockRejectedValue(
			new Error('no row for "owner@example.com"'),
		);
		await migrateGuestDataForVerifiedUser(db as never, "user-1");
		expect(spy).toHaveBeenLastCalledWith("[Guest Migration Error]", "Error");
		expect(JSON.stringify(spy.mock.calls)).not.toContain("owner@example.com");
		spy.mockRestore();
	});
});
