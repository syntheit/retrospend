/**
 * Unit tests for the shared auto-accept verification helpers.
 *
 * These functions are the single source of split-verification resolution for
 * three paths: expense create, expense update, and rebalance-on-add
 * (project.rebalanceExpenses). The rebalance path re-resolves EVERY split row
 * (existing participants included, actor excluded), so the AUTO_ACCEPTED case
 * below directly guards the reported bug where rebalancing reset opted-in users
 * back to PENDING.
 */

import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~prisma";
import { getAutoAcceptMap, resolveVerification } from "./auto-accept";
import type { ParticipantRef } from "./types";

const actor: ParticipantRef = {
	participantType: "user",
	participantId: "actor",
};

describe("resolveVerification", () => {
	it("the actor is always ACCEPTED", () => {
		const res = resolveVerification(actor, actor, new Map());
		expect(res.status).toBe("ACCEPTED");
		expect(res.verifiedAt).toBeInstanceOf(Date);
	});

	it("an auto-accept user resolves to AUTO_ACCEPTED, not PENDING", () => {
		const user: ParticipantRef = {
			participantType: "user",
			participantId: "opted-in",
		};
		const map = new Map([["opted-in", true]]);
		const res = resolveVerification(user, actor, map);
		expect(res.status).toBe("AUTO_ACCEPTED");
		expect(res.verifiedAt).toBeInstanceOf(Date);
	});

	it("an EXISTING auto-accept participant whose share changes returns to AUTO_ACCEPTED", () => {
		// Simulates a rebalance re-splitting an expense: an opted-in user who was
		// already on the expense must NOT be reset to PENDING just because their
		// share amount changed.
		const existing: ParticipantRef = {
			participantType: "user",
			participantId: "existing-opted-in",
		};
		const map = new Map([["existing-opted-in", true]]);
		const res = resolveVerification(existing, actor, map);
		expect(res.status).toBe("AUTO_ACCEPTED");
	});

	it("an opted-out user stays PENDING", () => {
		const user: ParticipantRef = {
			participantType: "user",
			participantId: "opted-out",
		};
		const map = new Map([["opted-out", false]]);
		const res = resolveVerification(user, actor, map);
		expect(res.status).toBe("PENDING");
		expect(res.verifiedAt).toBeUndefined();
	});

	it("a user missing from the map (no flag fetched) stays PENDING", () => {
		const user: ParticipantRef = {
			participantType: "user",
			participantId: "unknown",
		};
		const res = resolveVerification(user, actor, new Map());
		expect(res.status).toBe("PENDING");
	});

	it("guests and shadows can never auto-accept (they can't approve splits)", () => {
		const guest: ParticipantRef = {
			participantType: "guest",
			participantId: "g1",
		};
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: "s1",
		};
		// Even with a truthy map entry keyed by their id, non-users stay PENDING.
		const map = new Map([
			["g1", true],
			["s1", true],
		]);
		expect(resolveVerification(guest, actor, map).status).toBe("PENDING");
		expect(resolveVerification(shadow, actor, map).status).toBe("PENDING");
	});
});

describe("getAutoAcceptMap", () => {
	it("batch-fetches only user participants in a single query, keyed by id", async () => {
		const findMany = vi.fn().mockResolvedValue([
			{ id: "u1", autoAcceptSplits: true },
			{ id: "u2", autoAcceptSplits: false },
		]);
		const tx = { user: { findMany } } as unknown as Prisma.TransactionClient;

		const map = await getAutoAcceptMap(tx, [
			{ participantType: "user", participantId: "u1" },
			{ participantType: "user", participantId: "u2" },
			{ participantType: "guest", participantId: "g1" },
			{ participantType: "shadow", participantId: "s1" },
		]);

		expect(findMany).toHaveBeenCalledTimes(1);
		expect(findMany).toHaveBeenCalledWith({
			where: { id: { in: ["u1", "u2"] } },
			select: { id: true, autoAcceptSplits: true },
		});
		expect(map.get("u1")).toBe(true);
		expect(map.get("u2")).toBe(false);
		expect(map.has("g1")).toBe(false);
	});

	it("skips the query entirely when there are no user participants", async () => {
		const findMany = vi.fn();
		const tx = { user: { findMany } } as unknown as Prisma.TransactionClient;

		const map = await getAutoAcceptMap(tx, [
			{ participantType: "guest", participantId: "g1" },
			{ participantType: "shadow", participantId: "s1" },
		]);

		expect(findMany).not.toHaveBeenCalled();
		expect(map.size).toBe(0);
	});
});
