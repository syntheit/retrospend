/**
 * Unit tests for the shared auto-accept verification helper.
 *
 * resolveVerification is the single source of split-verification resolution for
 * three paths: expense create, expense update, and rebalance-on-add
 * (project.rebalanceExpenses). Auto-accept is a PROJECT behavior, so the helper
 * takes a single resolved projectAutoAccept flag (true for standalone expenses).
 * The rebalance path re-resolves EVERY split row (existing participants
 * included, actor excluded), so the AUTO_ACCEPTED case below directly guards the
 * reported bug where rebalancing reset accepted users back to PENDING.
 */

import { describe, expect, it } from "vitest";
import { resolveVerification } from "./auto-accept";
import type { ParticipantRef } from "./types";

const actor: ParticipantRef = {
	participantType: "user",
	participantId: "actor",
};

describe("resolveVerification", () => {
	it("the actor is always ACCEPTED", () => {
		const res = resolveVerification(actor, actor, false);
		expect(res.status).toBe("ACCEPTED");
		expect(res.verifiedAt).toBeInstanceOf(Date);
	});

	it("a non-actor user resolves to AUTO_ACCEPTED when the project auto-accepts", () => {
		const user: ParticipantRef = {
			participantType: "user",
			participantId: "u1",
		};
		const res = resolveVerification(user, actor, true);
		expect(res.status).toBe("AUTO_ACCEPTED");
		expect(res.verifiedAt).toBeInstanceOf(Date);
	});

	it("an EXISTING participant whose share changes returns to AUTO_ACCEPTED when the project auto-accepts", () => {
		// Simulates a rebalance re-splitting an expense: a user who was already on
		// the expense must NOT be reset to PENDING just because their share
		// amount changed, as long as the project auto-accepts.
		const existing: ParticipantRef = {
			participantType: "user",
			participantId: "existing",
		};
		const res = resolveVerification(existing, actor, true);
		expect(res.status).toBe("AUTO_ACCEPTED");
	});

	it("a non-actor user stays PENDING when the project requires approval", () => {
		const user: ParticipantRef = {
			participantType: "user",
			participantId: "u1",
		};
		const res = resolveVerification(user, actor, false);
		expect(res.status).toBe("PENDING");
		expect(res.verifiedAt).toBeUndefined();
	});

	it("guests and shadows auto-accept when the project auto-accepts", () => {
		const guest: ParticipantRef = {
			participantType: "guest",
			participantId: "g1",
		};
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: "s1",
		};
		expect(resolveVerification(guest, actor, true).status).toBe("AUTO_ACCEPTED");
		expect(resolveVerification(shadow, actor, true).status).toBe(
			"AUTO_ACCEPTED",
		);
	});

	it("a shadow always auto-accepts, even when the project requires approval", () => {
		// A ghost has no account or session and can never tap "accept", so leaving
		// it PENDING would strand the split forever and block period settlement.
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: "s1",
		};
		const res = resolveVerification(shadow, actor, false);
		expect(res.status).toBe("AUTO_ACCEPTED");
		expect(res.verifiedAt).toBeInstanceOf(Date);
	});

	it("a guest stays PENDING when the project requires approval", () => {
		// A guest has a session and CAN approve, so they follow the manual gate.
		const guest: ParticipantRef = {
			participantType: "guest",
			participantId: "g1",
		};
		expect(resolveVerification(guest, actor, false).status).toBe("PENDING");
	});
});
