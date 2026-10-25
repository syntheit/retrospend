import {
	describeLine,
	isConflict,
	memberKey,
	nameOfKey,
	settleAllDetailOf,
	type WillRecord,
} from "./settleAll";
import type { ProjectPage } from "./source";

describe("isConflict", () => {
	it("knows the problem the server answers when the balances moved", () => {
		expect(isConflict({ code: "conflict", status: 409 })).toBe(true);
		expect(isConflict({ status: 409 })).toBe(true);
		expect(isConflict({ code: "validation_failed", status: 422 })).toBe(false);
		expect(isConflict(new Error("offline"))).toBe(false);
		expect(isConflict(null)).toBe(false);
	});
});

describe("names on plan lines", () => {
	const members = [
		{ participantType: "user", participantId: "me1", name: "Sofía" },
		{ participantType: "shadow", participantId: "s9", name: "Mateo" },
	] as ProjectPage["members"];

	it("keys a member as the plan does", () => {
		expect(memberKey(members[1] as ProjectPage["members"][number])).toBe(
			"shadow:s9",
		);
	});

	it("finds the name, and falls back to the key for someone who left", () => {
		expect(nameOfKey(members, "shadow:s9")).toBe("Mateo");
		expect(nameOfKey(members, "user:gone")).toBe("user:gone");
	});
});

describe("settleAllDetailOf", () => {
	const detail = {
		kind: "project.settleAll",
		planned: [{ person: "user:lucia", currency: "BRL", minor: -12000 }],
		willRecord: [
			{
				person: "user:lucia",
				direction: "outgoing",
				amount: { minor: 12000, currency: "BRL" },
				status: "PROPOSED",
			},
		],
		skipped: [
			{
				person: "user:mateo",
				direction: "incoming",
				amount: { minor: 500, currency: "ARS" },
				reason: "matches_claim",
			},
		],
	};

	it("reads the payments and the skipped lines from the dry run", () => {
		const read = settleAllDetailOf({ detail });
		expect(read.willRecord).toHaveLength(1);
		expect(read.willRecord[0]?.status).toBe("PROPOSED");
		expect(read.skipped[0]?.reason).toBe("matches_claim");
	});

	it("says nothing before the preview, or for another kind of detail", () => {
		expect(settleAllDetailOf(null)).toEqual({ willRecord: [], skipped: [] });
		expect(settleAllDetailOf({ detail: { kind: "payment.record" } })).toEqual({
			willRecord: [],
			skipped: [],
		});
	});
});

describe("describeLine", () => {
	const line = (status: WillRecord["status"]): WillRecord => ({
		person: "user:lucia",
		direction: "outgoing",
		amount: { minor: 12000, currency: "BRL" },
		status,
	});

	it("marks a payment that waits for the other person", () => {
		expect(describeLine(line("PROPOSED"), () => "Lucía")).toEqual({
			key: "user:lucia:BRL",
			name: "Lucía",
			direction: "outgoing",
			waiting: true,
		});
		expect(describeLine(line("FINALIZED"), () => "Lucía").waiting).toBe(false);
	});
});
